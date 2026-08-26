/**
 * Epic · CV Tailoring C-phase (CI-048/050/051/052) — the acceptance checker.
 *
 * Read-only. Given a lead id, reads that lead's stored step runs and rows and
 * checks every criterion the four CIs in the epic set, printing PASS / FAIL /
 * INFO per line with the actual number beside it.
 *
 * It exists so the epic's click test is a matter of clicking and then reading
 * one screen, rather than remembering nine acceptance criteria spread across
 * four notes. It does NOT run anything and cannot substitute for the click
 * test — it reports what a run produced, not that a human drove it.
 *
 *   npx tsx scripts/verify-lead-run.ts <leadId>
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSkillItems, skillsBlock } from '../lib/docx/cv-skills';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, requirementTailoring, pipelineRuns, languages, education } from '../lib/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * The Skills entries as they appear in the generated document — the only place
 * the MERGED section exists. `cv_bullet_skills` holds C4's tags before C5
 * merges them, so it is the wrong source for anything about duplicates.
 * Returns null when the file or pandoc is unavailable, so the checker degrades
 * to skipping these lines rather than failing them.
 */
function printedSkills(leadId: string): string[] | null {
  const file = path.join(process.cwd(), '.storage', 'cv-output', leadId, 'tailored.docx');
  if (!fs.existsSync(file)) return null;
  try {
    // `--wrap=none` matters. With pandoc's default wrapping a category's last
    // skill and the next category's heading share a line, and flattening the
    // newlines then swallows that skill — it cost four to five entries per lead
    // when this checker was first written.
    const text = execFileSync('pandoc', ['-t', 'plain', '--wrap=none', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
    // The layout used to be one line per category, "Heading: a · b · c", and this
    // read the items by splitting on the colon. CI · CV Template Output Format §2.3
    // gave the category its own bold paragraph, at which point no line had a colon
    // and this returned zero entries on every lead — reported as a mismatch against
    // C5 rather than as a parse failure, which is the worse way to fail. The shape
    // of the section now lives in one place that knows both layouts.
    const block = skillsBlock(text.split('\n'));
    if (!block) return null;
    return parseSkillItems(block);
  } catch {
    return null;
  }
}

const PASS = '  PASS';
const FAIL = '  FAIL';
const INFO = '  ----';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

let failures = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? PASS : FAIL}  ${label.padEnd(46)} ${detail}`);
};
const info = (label: string, detail: string) => console.log(`${INFO}  ${label.padEnd(46)} ${detail}`);

async function main() {
  const leadId = process.argv[2];
  if (!leadId) {
    console.error('usage: npx tsx scripts/verify-lead-run.ts <leadId>');
    process.exit(1);
  }
  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) {
    console.error(`No lead ${leadId}`);
    process.exit(1);
  }

  const runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.jobLeadId, leadId)).orderBy(desc(pipelineRuns.createdAt));
  const latest = (step: string) => runs.find((r) => (r as { step?: string }).step === step) as { output?: Record<string, unknown>; createdAt?: Date } | undefined;
  const out = (step: string) => (latest(step)?.output ?? {}) as Record<string, unknown>;

  const rows = await db.select().from(requirementTailoring).where(eq(requirementTailoring.jobLeadId, leadId));
  const green = rows.filter((r) => r.approvalStatus === 'green');
  const printed = green.filter((r) => r.cvBullet);
  const reqs = await db.select().from(jobRequirements).where(eq(jobRequirements.jobLeadId, leadId));
  const langs = (await db.select().from(languages).where(eq(languages.ownerId, lead.ownerId))).map((l) => (l.language ?? '').toLowerCase()).filter(Boolean);
  const degrees = (await db.select().from(education).where(eq(education.ownerId, lead.ownerId))).map((e) => (e.qualification ?? '').toLowerCase()).filter(Boolean);

  console.log(`\n${lead.title ?? '(untitled)'}${lead.company ? ` · ${lead.company}` : ''}`);
  console.log(`${leadId}\n${'='.repeat(78)}`);

  // ── The phase ran at all, and in the current shape ────────────────────────
  const steps = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];
  const missing = steps.filter((s) => !latest(s));
  check(missing.length === 0, 'every C-phase step has run', missing.length ? `missing ${missing.join(', ')}` : steps.join(' '));
  const c3at = latest('C3')?.createdAt;
  info('last C3 (selection) at', c3at ? new Date(c3at).toISOString().slice(0, 16) : '(never)');

  // ── C3 · selection (CI-050) ───────────────────────────────────────────────
  const c3 = out('C3');
  const bullets = new Set(printed.map((r) => r.evidenceRef)).size;
  check(bullets >= 13 && bullets <= 16, 'bullets within the 13-16 budget', `${bullets} bullets from ${green.length} green rows`);
  const cov = (c3.coverage ?? {}) as Record<string, string>;
  info('coverage · all Keep evidence', cov.beforeAllKeep ?? '(not reported)');
  // CI-054 §2.3's reading — bullets first, then what the fixed sections answer.
  // The two narrower readings stay below it: `afterAsPrinted` is what the two
  // checks underneath parse, and a run from before this shipped has no `split`.
  info('coverage · bullets + fixed sections', cov.split ?? '(not reported)');
  info('coverage · as printed', cov.afterAsPrinted ?? '(not reported)');
  info('coverage · bullets only', cov.afterBulletsOnly ?? '(not reported)');
  const asPrinted = cov.afterAsPrinted ?? '';
  const held = /Core (\d+)\/(\d+)/.exec(asPrinted);
  const heldImp = /Important (\d+)\/(\d+)/.exec(asPrinted);
  if (held) check(held[1] === held[2], 'Core coverage held at 100% (as printed)', `Core ${held[1]}/${held[2]}`);
  if (heldImp) check(heldImp[1] === heldImp[2], 'Important coverage held at 100% (as printed)', `Important ${heldImp[1]}/${heldImp[2]}`);
  info('Nice-to-Have', /Nice-to-Have [\d/]+/.exec(asPrinted)?.[0] ?? '(none on this lead)');

  // ── C4 · bullets and their tags (CI-051) ──────────────────────────────────
  const c4 = out('C4');
  check(Number(c4.count ?? 0) === bullets, 'C4 wrote one bullet per selected ref', `C4 count=${c4.count} · distinct refs=${bullets}`);
  // Neither counter is a pass/fail. An orphan dropped is the guard doing its job;
  // an uncovered My Skill is a capability re-expressed rather than carried by name.
  // Both are prompts on attention, and a large number on either is worth a look.
  info('unanchored tags dropped by the guard', String(c4.orphanTags ?? '?') + '  (the guard working; large = tags drifting off bullets)');
  info('My Skills not carried into a tag', String(c4.uncovered ?? '?') + '  (re-expression, not loss — see CI-051 §2.4)');

  // ── C5 · the Skills section (CI-042 / CI-048) ─────────────────────────────
  const c5 = out('C5');
  const cats = (c5.categories ?? []) as { n: number; category: string }[];
  const skills = Number(c5.skills ?? 0);
  check(cats.length >= 3 && cats.length <= 5, 'Skills section has 3-5 categories', `${cats.length}: ${cats.map((c) => `${c.category} (${c.n})`).join(' · ')}`);
  check(Number(c5.unplaced ?? 0) === 0, 'no skill fell into Additional Skills', `unplaced=${c5.unplaced ?? '?'}`);
  info('skills printed', `${skills}   (benchmark 16-20; merging is what closes the gap)`);
  info('entries merged by C5', String(c5.merged ?? '(not reported)'));
  const biggest = cats.reduce((m, c) => Math.max(m, c.n), 0);
  check(biggest <= 8, 'no category exceeds 8 skills (C5 §B.1)', `largest category = ${biggest}`);

  // ── What actually PRINTED, read out of the .docx ──────────────────────────
  //
  // Read from the document, not from `cv_bullet_skills`. Those are C4's tags
  // BEFORE C5 merges them, and checking duplicates against them reports every
  // pair C5 successfully collapsed as if it had survived — a false alarm this
  // checker raised on its first run, on all three leads. The merged section
  // exists only in the .docx, so that is what gets read.
  const uniq = printedSkills(leadId);
  if (!uniq) {
    info('printed Skills section', '(could not read the .docx — is pandoc installed?)');
  } else {
    const lower = uniq.map((s) => s.toLowerCase());
    const langHit = lower.filter((t) => langs.some((l) => new RegExp(`(^|[^a-z])${l}([^a-z]|$)`).test(t)));
    const degHit = lower.filter((t) => /\b(degree|master'?s|bachelor|postgraduate|mba|diploma)\b/.test(t) || degrees.some((d) => d && t.includes(d)));
    check(langHit.length === 0, 'no language appears as a printed skill', langHit.length ? langHit.join(' · ') : 'none');
    check(degHit.length === 0, 'no qualification appears as a printed skill', degHit.length ? degHit.join(' · ') : 'none');

    const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !['and', 'of', 'the', 'for', 'with'].includes(w));
    const pairs: string[] = [];
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) {
        const a = new Set(norm(uniq[i])), b = new Set(norm(uniq[j]));
        const shared = [...a].filter((w) => b.has(w)).length;
        if (shared >= 2 && shared >= Math.min(a.size, b.size)) pairs.push(`${uniq[i]}  ~  ${uniq[j]}`);
      }
    check(pairs.length === 0, 'no near-duplicate survived into the CV', pairs.length ? `${pairs.length} pair(s)` : 'none');
    for (const p of pairs.slice(0, 6)) console.log(`          ${p}`);
    check(uniq.length === skills, 'printed entries match what C5 reported', `${uniq.length} in the .docx · ${skills} in the step report`);
  }

  // ── C7 / C8 ───────────────────────────────────────────────────────────────
  const c7 = out('C7');
  check(c7.how === 'real template', 'CV rendered through the real Word template', String(c7.how ?? '(unknown)'));
  // C8 stores `atsRating` as a number. Older runs carry only a prose summary with
  // the score inside it, so both shapes are read — the regex alone reported "?"
  // on every run made after the field was added.
  const c8 = out('C8');
  const rating = num(c8.atsRating) ?? /(\d{2,3})\/100/.exec(String(JSON.stringify(c8)))?.[1];
  info('ATS rating', `${rating ?? '?'}/100`);

  console.log('='.repeat(78));
  console.log(failures === 0 ? 'All machine-checkable criteria pass.' : `${failures} criterion/criteria FAILED — read above.`);
  console.log('This checker cannot verify that a HUMAN drove the app. That is the click test.\n');
  process.exit(0);
}

main();
