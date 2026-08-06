/**
 * Propose Skill → STAR links for skills that currently have none.
 *
 * The Career Graph draws a skill node as "unlinked" when its `starEvidence`
 * array (skills_master.star_evidence) is empty — nothing tells the graph which
 * STAR stor(ies) actually demonstrate it, so it renders as an orphan dot with
 * no dashed line to anything.
 *
 * This is a PROPOSAL tool, not a writer: by default it only prints candidate
 * STAR refs per unlinked skill, ranked by plain keyword overlap between the
 * skill's own name/ATS variants and each STAR's aggregated text (title +
 * actions + results + competences + attributes). Nothing is saved unless you
 * pass --apply, in which case only skills with a single, reasonably confident
 * match (score >= APPLY_THRESHOLD, no close runner-up) get written; everything
 * else is left for you to judge by hand — a keyword match is a hint, not proof
 * the skill was actually demonstrated there.
 *
 * Usage:
 *   npx tsx scripts/propose-skill-star-links.ts            # report only
 *   npx tsx scripts/propose-skill-star-links.ts --apply     # also writes the
 *                                                            # confident matches
 */
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  DEMO_OWNER_ID,
  skillsMaster,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
} from '../lib/db/schema';

const TOP_N = 3;
const APPLY_THRESHOLD = 3; // shared tokens needed before --apply will write it
const RUNNER_UP_MARGIN = 2; // top candidate must beat #2 by at least this much

const tokens = (s: string): Set<string> => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a: Set<string>, b: Set<string>): { n: number; shared: string[] } => {
  const shared = [...a].filter((t) => b.has(t));
  return { n: shared.length, shared };
};

async function main() {
  const apply = process.argv.includes('--apply');
  const owner = DEMO_OWNER_ID;

  const [skills, starRows, actions, results, competences, attributes] = await Promise.all([
    db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, owner)),
    db.select().from(stars).where(eq(stars.ownerId, owner)),
    db.select().from(starActions).where(eq(starActions.ownerId, owner)),
    db.select().from(starResults).where(eq(starResults.ownerId, owner)),
    db.select().from(starCompetences).where(eq(starCompetences.ownerId, owner)),
    db.select().from(starAttributes).where(eq(starAttributes.ownerId, owner)),
  ]);

  if (starRows.length === 0) {
    console.log('No STAR stories found for this owner — nothing to propose against.');
    process.exit(0);
  }

  // One token set per STAR, built from everything hung off it.
  const starTokens = new Map<string, { star: (typeof starRows)[number]; tokens: Set<string> }>();
  for (const s of starRows) {
    if (!s.refCode) continue;
    starTokens.set(s.refCode, { star: s, tokens: tokens(`${s.title ?? ''} ${s.summary ?? ''}`) });
  }
  const addTo = (starRef: string | null, text: string | null) => {
    if (!starRef) return;
    const entry = starTokens.get(starRef);
    if (!entry) return;
    for (const t of tokens(text ?? '')) entry.tokens.add(t);
  };
  for (const a of actions) addTo(a.starRef, a.text);
  for (const r of results) addTo(r.starRef, r.text);
  for (const c of competences) addTo(c.starRef, c.competence);
  for (const at of attributes) addTo(at.starRef, at.attribute);

  const unlinked = skills.filter((s) => (s.starEvidence ?? []).length === 0);
  if (unlinked.length === 0) {
    console.log('Every skill already has at least one STAR link — nothing to propose.');
    process.exit(0);
  }

  console.log(`${unlinked.length} of ${skills.length} skills have no STAR link.\n`);

  const toApply: { skillId: string; refs: string[] }[] = [];

  for (const sk of unlinked) {
    const skillTokens = tokens(`${sk.skill ?? ''} ${(sk.atsKeywordVariants ?? []).join(' ')}`);
    const ranked = [...starTokens.values()]
      .map(({ star, tokens: st }) => ({ star, ...overlap(skillTokens, st) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, TOP_N);

    console.log(`[${sk.refCode ?? '—'}] ${sk.skill ?? '(no name)'}`);
    if (ranked.length === 0) {
      console.log('    no textual match against any STAR — needs a manual read, not a keyword guess.\n');
      continue;
    }
    for (const r of ranked) {
      console.log(`    → [${r.star.refCode}] ${r.star.title ?? '(untitled)'}  (${r.n} shared term${r.n === 1 ? '' : 's'}: ${r.shared.join(', ')})`);
    }
    console.log('');

    const [best, runnerUp] = ranked;
    if (best.n >= APPLY_THRESHOLD && (!runnerUp || best.n - runnerUp.n >= RUNNER_UP_MARGIN) && best.star.refCode) {
      toApply.push({ skillId: sk.id, refs: [best.star.refCode] });
    }
  }

  if (!apply) {
    console.log(`Report only — ${toApply.length} of ${unlinked.length} would qualify for auto-apply (score ≥ ${APPLY_THRESHOLD}, clear of the runner-up by ${RUNNER_UP_MARGIN}+). Re-run with --apply to write those, or add the rest by hand from the list above.`);
    process.exit(0);
  }

  for (const { skillId, refs } of toApply) {
    await db.update(skillsMaster).set({ starEvidence: refs }).where(eq(skillsMaster.id, skillId));
  }
  console.log(`Applied ${toApply.length} confident link${toApply.length === 1 ? '' : 's'}. ${unlinked.length - toApply.length} skill(s) still need a manual call — see the list above.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
