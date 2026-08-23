/**
 * Normalize skillsMaster.starEvidence from human-readable shorthand into plain STAR
 * ref-code arrays.
 *
 * Confirmed against real data (2026-08-06, via scripts/diagnose-career-graph-orphans.ts and
 * the user's own query of skills_master): entries were typed as free text — "STAR 4",
 * "STARs 1" (only the first item in a list usually carries the word), plus two aggregate
 * entries, "All STARs" and "All senior STARs" — rather than the plain ref codes ("1".."7")
 * that stars.ref_code, star_competences.star_ref etc. actually use. The Career Graph now
 * parses this shorthand at render time (lib/career-graph-view-model.ts,
 * `resolveStarEvidenceRef`), but the user asked to also clean the underlying data so it
 * matches the convention every other evidence table already uses — this script does that.
 *
 * Reuses `resolveStarEvidenceRef`/`seniorStarRefCodesOf` from the view-model directly
 * (not a reimplementation) so the stored data and the graph's interpretation of it can
 * never drift apart.
 *
 * "All STARs" / "All senior STARs" are expanded to a literal list of today's STAR ref
 * codes — explicit user choice, made knowing the tradeoff: a STAR added later will NOT
 * automatically be covered by these two skills anymore; add it to their evidence by hand.
 *
 * An entry that doesn't resolve to any real STAR ref (a genuine data gap, not shorthand)
 * is left in place rather than silently dropped, so nothing disappears unnoticed — same
 * principle as leaving the 3 garbage skillsMaster rows visible until a human confirmed
 * they were junk, rather than guessing they should be deleted.
 *
 * Report-only by default; --apply writes the cleaned arrays.
 *
 * Usage:
 *   npx tsx scripts/normalize-skill-star-evidence.ts            # report only
 *   npx tsx scripts/normalize-skill-star-evidence.ts --apply     # writes the cleaned arrays
 */
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, positions, stars, skillsMaster } from '../lib/db/schema';
import { normRef, resolveStarEvidenceRef, seniorStarRefCodesOf } from '../lib/career-graph-view-model';

async function main() {
  const apply = process.argv.includes('--apply');
  const owner = DEMO_OWNER_ID;

  const [pos, st, skills] = await Promise.all([
    db.select().from(positions).where(eq(positions.ownerId, owner)),
    db.select().from(stars).where(eq(stars.ownerId, owner)),
    db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, owner)),
  ]);

  const allStarRefCodes = st.map((s) => s.refCode).filter((r): r is string => !!r);
  const seniorStarRefCodes = seniorStarRefCodesOf(st, pos);
  const validRefs = new Set(allStarRefCodes.map(normRef));

  console.log(`"All STARs" today resolves to: [${allStarRefCodes.join(', ')}]`);
  console.log(
    `"All senior STARs" today resolves to: [${seniorStarRefCodes.join(', ')}] ` +
      '(Head of Governance and Strategy, Deputy Head of Controlling & IT, Senior Analyst to the Board, Trade Marketing Coordinator)\n'
  );

  let changedCount = 0;
  const toApply: { id: string; newVal: string[] }[] = [];

  for (const sk of skills) {
    const oldVal = sk.starEvidence ?? [];
    if (oldVal.length === 0) continue;

    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const raw of oldVal) {
      const candidates = resolveStarEvidenceRef(raw, allStarRefCodes, seniorStarRefCodes);
      let matchedAny = false;
      for (const c of candidates) {
        if (validRefs.has(normRef(c))) {
          matchedAny = true;
          if (!resolved.includes(c)) resolved.push(c);
        }
      }
      if (!matchedAny) unresolved.push(raw);
    }
    const newVal = [...resolved, ...unresolved];

    if (JSON.stringify(newVal) === JSON.stringify(oldVal)) continue;
    changedCount++;
    console.log(`[${sk.refCode ?? sk.id}] ${sk.skill ?? '(no name)'}`);
    console.log(`    before: [${oldVal.join(', ')}]`);
    console.log(
      `    after:  [${newVal.join(', ')}]` +
        (unresolved.length ? `   ← ${unresolved.length} entry could not be resolved, kept as-is: ${unresolved.join(', ')}` : '')
    );
    toApply.push({ id: sk.id, newVal });
  }

  if (changedCount === 0) {
    console.log('Nothing to clean — every starEvidence entry is already a plain, resolvable ref code.');
    process.exit(0);
  }

  if (!apply) {
    console.log(`\nReport only — ${changedCount} of ${skills.length} skills would change. Re-run with --apply to write these.`);
    process.exit(0);
  }

  for (const { id, newVal } of toApply) {
    await db.update(skillsMaster).set({ starEvidence: newVal }).where(eq(skillsMaster.id, id));
  }
  console.log(`\nApplied — ${changedCount} skill(s) updated.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
