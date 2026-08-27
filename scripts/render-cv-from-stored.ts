/**
 * Re-render ONE lead's CV from what its last run already stored — no LLM calls, no
 * cost. The mechanics live in `lib/pipeline/rerender-cv.ts`; this is the handle.
 *
 * WHY: every change to `Group CVs/CV_Template.docx` has to be looked at on a real
 * page before it can be believed, and until this existed the only way to get one
 * was to spend a full C1–C8 run. That made the template the least-verified part of
 * the build, which is how it accumulated six format defects at once (CI · CV
 * Template Output Format).
 *
 * CALIBRATING THE BULLET BUDGET (§2.7)
 * `--bullets N` keeps only the N highest-ranked distinct evidence refs, which is
 * what `SELECTION_DEFAULTS.budget = N` would have selected: C3 ranks by marginal
 * coverage and writes the order into `shortlist_rank`, so truncating that order is
 * the same set, and every ref that survives keeps the real bullet C4 wrote for it.
 * Sweep N, count pages in Word, and the budget stops being an estimate.
 *
 * MEASURING THE SPACE BUDGET (CI · C7 Space Rules Are Specified and Never Enforced)
 * `--profile-words N` truncates the stored profile to N words and `--skills CxP`
 * re-shapes the stored Skills section to C categories of P, so the LINE COST of a
 * budget can be measured before that budget is shipped. Neither changes anything
 * stored; both exist because `lib/cv-budget.ts`'s figures are derived from a
 * character width, and a derived number that has not been seen on a page is
 * exactly the kind of number this CI exists to stop trusting.
 *
 * Pair either with `scripts/cv-pages.ps1`, which asks Word for the page count.
 *
 *   npx tsx scripts/render-cv-from-stored.ts <leadId> [outPath] [--bullets N]
 *                                            [--profile-words N] [--skills CxP]
 *
 * For the whole back catalogue at once, use `scripts/regenerate-cvs.ts`.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { rerenderCv } from '../lib/pipeline/rerender-cv';

async function main() {
  const leadId = process.argv[2];
  if (!leadId) throw new Error('usage: npx tsx scripts/render-cv-from-stored.ts <leadId> [outPath] [--bullets N]');

  const intFlag = (name: string): number | undefined => {
    const i = process.argv.indexOf(name);
    if (i === -1) return undefined;
    const n = Number(process.argv[i + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a positive integer`);
    return n;
  };
  const bulletCap = intFlag('--bullets');
  const profileWords = intFlag('--profile-words');

  const shapeIdx = process.argv.indexOf('--skills');
  let skillsShape: [number, number] | undefined;
  if (shapeIdx !== -1) {
    const m = /^(\d+)x(\d+)$/.exec(process.argv[shapeIdx + 1] ?? '');
    if (!m) throw new Error('--skills needs a shape like 4x5 (categories x per category)');
    skillsShape = [Number(m[1]), Number(m[2])];
  }

  const r = await rerenderCv(leadId, { bulletCap, profileWords, skillsShape });
  const out = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined) ?? path.join('_local', `cv-${leadId.slice(0, 8)}.docx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, r.buffer);

  console.log(`${r.title} · ${r.company} · city ${r.city || '(none)'}`);
  console.log(`${r.bullets} bullets · ${r.skills} skills in ${r.skillGroups} groups · ${r.headshot ? 'headshot' : 'no headshot'}`);
  console.log(`relocation clause: ${r.relocation || '(suppressed)'}`);
  for (const w of r.warnings) console.log(`!  ${w}`);
  console.log(`\nWrote ${out}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
