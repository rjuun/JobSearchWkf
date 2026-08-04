/**
 * Per-step output-token distribution over `llm_calls` — the free way to turn
 * "the last N leads looked fine" into evidence.
 *
 * ── Why output tokens ───────────────────────────────────────────────────────
 * Every collapse this codebase has found shares one fingerprint: a reply an
 * order of magnitude shorter than the step's healthy output, that is still
 * schema-valid, still logged `status='ok'`, still `attempts=1`. B2 returned ~65
 * tokens against ~3,200. B6 returned 256-430 against 2,300-3,700. C2 returned
 * 108 against ~2,000. None of them errored, and none showed up as missing rows —
 * which is why counting rows never finds this and counting tokens does.
 *
 * So: median per step, and anything below `median / DIP` flagged as suspect.
 * Median rather than mean because one collapsed run drags a mean toward itself
 * and then hides the next one.
 *
 * Strictly READ-ONLY — a single SELECT. Nothing is written, no LLM is called,
 * and it costs nothing to run.
 *
 * Usage:
 *   npx tsx scripts/audit-llm-call-shape.ts               # last 7 days, live calls
 *   npx tsx scripts/audit-llm-call-shape.ts --days 30
 *   npx tsx scripts/audit-llm-call-shape.ts --days 0      # all history
 *   npx tsx scripts/audit-llm-call-shape.ts --step C2 --days 30
 *   npx tsx scripts/audit-llm-call-shape.ts --markdown    # paste-ready CI table
 */
import './_env';
import { desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { llmCalls } from '../lib/db/schema';

/** A call below median/DIP is short enough that it cannot be a healthy reply. */
const DIP = 5;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const days = flag('--days') !== undefined ? parseInt(flag('--days')!, 10) : 7;
const onlyStep = flag('--step')?.toUpperCase();
const markdown = argv.includes('--markdown');

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

async function main() {
  const rows = await db.select().from(llmCalls).orderBy(desc(llmCalls.createdAt));

  const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const scoped = rows.filter((r) => {
    if (r.mode === 'mock') return false; // mock output is deterministic, not evidence
    if (since && r.createdAt && new Date(r.createdAt).getTime() < since) return false;
    if (onlyStep && (r.step ?? '').toUpperCase() !== onlyStep) return false;
    // Backtest/measurement traffic is tagged `<STEP>-bt-…` / `<STEP>-measure-…`
    // so it stays separable from production. Exclude it — it is deliberately
    // sampled and would skew the production picture.
    if (/-(bt|measure)-/.test(r.step ?? '')) return false;
    return true;
  });

  if (!scoped.length) {
    console.log('\nNo live production calls in range. Try --days 0, or drop --step.\n');
    process.exit(0);
  }

  const byStep = new Map<string, typeof scoped>();
  for (const r of scoped) {
    const k = r.step ?? '(none)';
    if (!byStep.has(k)) byStep.set(k, []);
    byStep.get(k)!.push(r);
  }

  const window = days > 0 ? `last ${days} day(s)` : 'all history';
  const leads = new Set(scoped.map((r) => r.jobLeadId).filter(Boolean)).size;
  console.log(`\nLive production LLM calls · ${window} · ${scoped.length} call(s) across ${leads} lead(s)\n`);

  const head = ['Step', 'n', 'median out', 'min', 'max', `suspect (<median/${DIP})`, 'errors', 'non-tool_use stop', 'retried'];
  const lines: string[][] = [];
  const suspects: { step: string; out: number; leadId: string | null; at: string }[] = [];

  for (const [step, calls] of [...byStep.entries()].sort()) {
    const outs = calls.map((c) => c.outputTokens ?? 0);
    const med = median(outs);
    const floor = Math.round(med / DIP);
    const low = calls.filter((c) => med > 0 && (c.outputTokens ?? 0) < floor);
    for (const c of low) {
      suspects.push({ step, out: c.outputTokens ?? 0, leadId: c.jobLeadId, at: c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '?' });
    }
    lines.push([
      step,
      String(calls.length),
      String(med),
      String(Math.min(...outs)),
      String(Math.max(...outs)),
      String(low.length),
      String(calls.filter((c) => c.status !== 'ok').length),
      // A tool-call step should always stop on `tool_use`. `max_tokens` means a
      // TRUNCATED tool input, which a schema with .default([]) parses as clean.
      String(calls.filter((c) => c.stopReason && c.stopReason !== 'tool_use').length),
      String(calls.filter((c) => (c.attempts ?? 1) > 1).length),
    ]);
  }

  if (markdown) {
    console.log(`| ${head.join(' | ')} |`);
    console.log(`| ${head.map(() => '---').join(' | ')} |`);
    for (const l of lines) console.log(`| ${l.join(' | ')} |`);
  } else {
    const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
    console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
    console.log(w.map((n) => '-'.repeat(n)).join('  '));
    for (const l of lines) console.log(l.map((c, i) => c.padEnd(w[i])).join('  '));
  }

  // ── Caught vs shipped ──────────────────────────────────────────────────────
  // A short call is NOT by itself a defect. B2's `tooThin`, B6's `unjudged` and
  // C3's floor all re-ask by calling runStructured again, and each attempt is
  // its own `llm_calls` row — so a guard that fires leaves the collapsed attempt
  // behind on purpose. (`attempts` here counts runStructured's internal zod
  // retry, not the guard's re-asks, so it stays 1 through all of this.)
  //
  // What decided the lead is the LAST call for that lead+step. A suspect
  // followed by a healthy call is the guard working. A suspect that IS the last
  // call is a collapse that reached the database.
  const lastByLeadStep = new Map<string, (typeof scoped)[number]>();
  for (const r of [...scoped].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())) {
    lastByLeadStep.set(`${r.jobLeadId}|${r.step}`, r);
  }
  const shipped = suspects.filter((s) => {
    const last = lastByLeadStep.get(`${s.leadId}|${s.step}`);
    return last && (last.outputTokens ?? 0) === s.out && last.createdAt && new Date(last.createdAt).toISOString().slice(0, 16).replace('T', ' ') === s.at;
  });
  const caught = suspects.length - shipped.length;

  if (suspects.length) {
    console.log(`\n── ${suspects.length} short call(s) — output below median/${DIP} ──`);
    console.log(`   ${caught} recovered by a re-ask · ${shipped.length} were the final call for that lead+step\n`);
    for (const s of suspects.sort((a, b) => a.step.localeCompare(b.step) || a.out - b.out)) {
      const isShipped = shipped.includes(s);
      console.log(`  ${isShipped ? 'SHIPPED ' : 'caught  '}${s.step.padEnd(6)} ${String(s.out).padStart(5)} tok   ${s.at}   lead ${s.leadId ?? '—'}`);
    }
    if (shipped.length) {
      console.log(`\n${shipped.length} collapse(s) reached the database. Open those leads and check the step's output.`);
      console.log('A genuinely short JD produces a genuinely short reply, so confirm before treating it as a defect.');
    } else {
      console.log('\nEvery short call was followed by a healthy one for the same lead+step —');
      console.log('the re-ask guards fired and recovered. Nothing degraded reached the database.');
    }
  } else {
    console.log('\nNo short calls: every step\'s output sits within a factor of ' + DIP + ' of its median.');
  }

  console.log('\nRead-only — nothing was written.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
