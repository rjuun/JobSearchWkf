/**
 * Batch-runs B1-B6 screening (lib/pipeline/screening.ts::runScreening) over
 * the past applications whose JD text was recovered from the SharePoint
 * "Applications" library export and populated via populate-jd-text.ts
 * (step 5 of the reconciliation — see that script and reconcile-sharepoint.ts
 * for the earlier steps).
 *
 * Costs real Anthropic API calls: B2, B3, B4, B5 (skipped if requirements
 * already exist) each make one Sonnet call, and B6 makes one Opus call —
 * up to 5 live LLM calls per lead. That's why this is a script the owner
 * runs themselves rather than something run automatically.
 *
 * Targets exactly the leads listed in scripts/data/jd-populate-data.json
 * (the same 109 seqs populate-jd-text.ts writes jd_text for), and only
 * those whose job_leads.jd_text is actually set (i.e. populate-jd-text.ts
 * --apply has already been run for them) and which haven't been screened yet
 * (overall_fit_score is still null) — safe to re-run after an interruption,
 * since already-screened leads are skipped.
 *
 * Usage:
 *   npx tsx scripts/batch-screen.ts             # dry run — lists what would be screened, no LLM calls
 *   npx tsx scripts/batch-screen.ts --apply             # run screening on all eligible leads
 *   npx tsx scripts/batch-screen.ts --apply --limit 5   # run screening on just the first 5 (smoke test)
 *   npx tsx scripts/batch-screen.ts --apply --seq 76,101,124   # run screening on specific seqs only
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, jobLeads } from '../lib/db/schema';
import { runScreening } from '../lib/pipeline/screening';
import { isLiveLlm } from '../lib/env';

type Row = { seq: number; leadId: string; title: string | null; company: string | null };

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const seqIdx = args.indexOf('--seq');
  const seqFilter = seqIdx !== -1 ? new Set(args[seqIdx + 1].split(',').map((s) => parseInt(s.trim(), 10))) : undefined;
  return { apply, limit, seqFilter };
}

async function main() {
  const { apply, limit, seqFilter } = parseArgs();
  const dataPath = path.join(__dirname, 'data', 'jd-populate-data.json');
  let rows: Row[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (seqFilter) rows = rows.filter((r) => seqFilter.has(r.seq));

  console.log(`${rows.length} candidate leads loaded from jd-populate-data.json.`);
  if (!isLiveLlm) {
    console.log('WARNING: LLM_MODE is not "live" or ANTHROPIC_API_KEY is unset — runScreening() will use MOCK judgments, not real LLM calls.');
  }

  // Filter to leads that actually have a JD in storage and haven't been screened yet.
  const eligible: Row[] = [];
  const skippedNoJd: number[] = [];
  const skippedAlreadyScreened: number[] = [];

  for (const r of rows) {
    const [lead] = await db
      .select({ id: jobLeads.id, jdText: jobLeads.jdText, overallFitScore: jobLeads.overallFitScore, status: jobLeads.status })
      .from(jobLeads)
      .where(and(eq(jobLeads.id, r.leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)))
      .limit(1);
    if (!lead || !lead.jdText) {
      skippedNoJd.push(r.seq);
      continue;
    }
    if (lead.overallFitScore != null) {
      skippedAlreadyScreened.push(r.seq);
      continue;
    }
    eligible.push(r);
  }

  console.log(
    `Eligible: ${eligible.length}. Skipped ${skippedNoJd.length} with no jd_text yet (run populate-jd-text.ts --apply first), ` +
      `${skippedAlreadyScreened.length} already screened (overall_fit_score set).`
  );
  if (skippedNoJd.length) console.log(`  No JD: seqs ${skippedNoJd.join(', ')}`);
  if (skippedAlreadyScreened.length) console.log(`  Already screened: seqs ${skippedAlreadyScreened.join(', ')}`);

  const toRun = limit ? eligible.slice(0, limit) : eligible;
  console.log(`\nPlanned this run: ${toRun.length} lead(s)${limit ? ` (--limit ${limit})` : ''}.`);
  for (const r of toRun.slice(0, 20)) console.log(`  seq ${r.seq}: ${r.title} — ${r.company}`);
  if (toRun.length > 20) console.log(`  ... and ${toRun.length - 20} more`);

  if (!apply) {
    console.log('\nDry run only — no LLM calls made. Re-run with --apply to actually screen these leads.');
    process.exit(0);
  }

  console.log(`\nRunning B1-B6 on ${toRun.length} lead(s) — this will make live Anthropic API calls...\n`);

  let ok = 0;
  const failures: { seq: number; error: string }[] = [];

  for (const [i, r] of toRun.entries()) {
    const t = Date.now();
    process.stdout.write(`[${i + 1}/${toRun.length}] seq ${r.seq} — ${r.title} / ${r.company} ... `);
    try {
      const reports = await runScreening(r.leadId, DEMO_OWNER_ID);
      const b6 = reports.find((rep) => rep.step === 'B6');
      console.log(`done in ${Date.now() - t}ms — ${b6?.summary ?? 'no B6 summary'}`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${msg}`);
      failures.push({ seq: r.seq, error: msg });
    }
  }

  console.log(`\nDone. Screened ${ok}/${toRun.length} successfully.`);
  if (failures.length) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  seq ${f.seq}: ${f.error}`);
    console.log('\nRe-run this same command — already-screened leads are skipped automatically, so it will only retry the failures.');
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
