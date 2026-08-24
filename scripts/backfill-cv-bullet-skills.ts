/**
 * Backfill `requirement_tailoring.cv_bullet_skills` and restore
 * `requirement_skills` to what B2 actually extracted.
 *
 * CI · Split cv_bullet_skills from requirement_skills. Before that split, C4
 * wrote its bracketed tag straight over `requirement_skills`, so on any row
 * where C4 has run that column holds the BULLET's skills, not the
 * REQUIREMENT's. Nothing was lost — B2's extraction still sits on
 * `job_requirements.skills` — so both halves are recoverable:
 *
 *   1. rows where C4 has run (`cv_bullet` non-empty): the tag currently in
 *      `requirement_skills` moves to `cv_bullet_skills`, where it belongs.
 *   2. every row with a `requirement_id`: `requirement_skills` is restored
 *      from its requirement's own `skills`. Idempotent — on a row C4 never
 *      touched it rewrites the same value it already had.
 *
 * Step 1 is skipped for a row that already has `cv_bullet_skills`, so re-running
 * this after a fresh C4 pass cannot clobber a real tag with a stale one.
 *
 * Report-only by default; --apply writes.
 *
 * Usage:
 *   npx tsx scripts/backfill-cv-bullet-skills.ts            # report only
 *   npx tsx scripts/backfill-cv-bullet-skills.ts --apply    # writes
 */
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { requirementTailoring, jobRequirements } from '../lib/db/schema';

const APPLY = process.argv.includes('--apply');

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

async function main() {
  const rows = await db.select().from(requirementTailoring);
  const reqs = await db.select().from(jobRequirements);
  const askedByReqId = new Map(reqs.map((r) => [r.id, r.skills ?? []]));

  const moves: { id: string; tag: string[] }[] = [];
  const restores: { id: string; from: string[]; to: string[] }[] = [];
  let alreadySplit = 0;
  let noRequirement = 0;

  for (const row of rows) {
    const stored = row.requirementSkills ?? [];
    const c4HasRun = !!row.cvBullet?.trim();
    const alreadyHasTag = (row.cvBulletSkills ?? []).length > 0;

    if (c4HasRun && !alreadyHasTag && stored.length > 0) moves.push({ id: row.id, tag: stored });
    else if (alreadyHasTag) alreadySplit++;

    if (!row.requirementId) {
      noRequirement++;
      continue;
    }
    const asked = askedByReqId.get(row.requirementId) ?? [];
    if (!same(stored, asked)) restores.push({ id: row.id, from: stored, to: asked });
  }

  console.log(`rows: ${rows.length}`);
  console.log(`  tag to move into cv_bullet_skills: ${moves.length}`);
  console.log(`  already carrying a tag (skipped):  ${alreadySplit}`);
  console.log(`  requirement_skills to restore:     ${restores.length}`);
  console.log(`  rows with no requirement_id:       ${noRequirement}`);

  for (const r of restores.slice(0, 5)) {
    console.log(`    e.g. ${r.id.slice(0, 8)}: [${r.from.join(', ')}]  ->  [${r.to.join(', ')}]`);
  }
  if (restores.length > 5) console.log(`    … and ${restores.length - 5} more`);

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to write.');
    process.exit(0);
  }

  // Order matters: move the tag out before overwriting the column it lives in.
  for (const m of moves) {
    await db.update(requirementTailoring).set({ cvBulletSkills: m.tag }).where(eq(requirementTailoring.id, m.id));
  }
  for (const r of restores) {
    await db.update(requirementTailoring).set({ requirementSkills: r.to }).where(eq(requirementTailoring.id, r.id));
  }
  console.log(`\nApplied: ${moves.length} tag(s) moved, ${restores.length} requirement_skills restored.`);
  process.exit(0);
}

main();
