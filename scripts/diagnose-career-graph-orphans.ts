/**
 * Diagnose orphan nodes in the Career Graph — report only, writes nothing.
 *
 * `components/roleproof/career-graph-view.tsx` renders a node with no links as a
 * lone dot, floating away from the rest of the graph once the force simulation
 * settles. The most common cause isn't missing evidence — it's a ref-code join
 * (`stars.positionRef`, `starActions.starRef`, `starResults.starRef`,
 * `responsibilities.positionRef`, `starCompetences.starRef`,
 * `starAttributes.starRef`, `skillsMaster.starEvidence`) failing on a formatting
 * difference (stray whitespace, a case slip like "f-r2" vs "F-R2") rather than the
 * evidence genuinely being unlinked. `lib/career-graph-view-model.ts` now
 * normalizes every one of those joins (trim + uppercase) before matching, but this
 * script checks it against your real data rather than assuming the fix landed —
 * and separates "was a formatting mismatch, now fixed" from "still doesn't match
 * anything, needs a look" so the two don't get confused.
 *
 * Usage:
 *   npx tsx scripts/diagnose-career-graph-orphans.ts
 */
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  DEMO_OWNER_ID,
  positions,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
  responsibilities,
  skillsMaster,
  bulletBank,
} from '../lib/db/schema';
import { buildGraphViewModel, normRef } from '../lib/career-graph-view-model';
import { EMPTY_TARGETS, type CareerGraph } from '../lib/career-graph';

async function main() {
  const owner = DEMO_OWNER_ID;

  const [pos, st, actions, results, competences, attributes, resp, skills, bullets] = await Promise.all([
    db.select().from(positions).where(eq(positions.ownerId, owner)),
    db.select().from(stars).where(eq(stars.ownerId, owner)),
    db.select().from(starActions).where(eq(starActions.ownerId, owner)),
    db.select().from(starResults).where(eq(starResults.ownerId, owner)),
    db.select().from(starCompetences).where(eq(starCompetences.ownerId, owner)),
    db.select().from(starAttributes).where(eq(starAttributes.ownerId, owner)),
    db.select().from(responsibilities).where(eq(responsibilities.ownerId, owner)),
    db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, owner)),
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, owner)),
  ]);

  const graph: CareerGraph = {
    profile: null,
    positions: pos,
    stars: st,
    actions,
    results,
    competences,
    attributes,
    responsibilities: resp,
    education: [],
    languages: [],
    bullets,
    bulletEvidence: [],
    skills,
    targets: EMPTY_TARGETS,
  };

  // ---------- Part 1: raw vs. normalized ref matching, per join ----------
  // Shows exactly which rows a formatting mismatch was hiding before the fix.
  const posRefsRaw = new Set(pos.map((p) => p.refCode).filter(Boolean) as string[]);
  const starRefsRaw = new Set(st.map((s) => s.refCode).filter(Boolean) as string[]);
  const posRefsNorm = new Map<string, string>(); // normalized -> a raw example
  posRefsRaw.forEach((r) => posRefsNorm.set(normRef(r), r));
  const starRefsNorm = new Map<string, string>();
  starRefsRaw.forEach((r) => starRefsNorm.set(normRef(r), r));

  function checkJoin(label: string, rows: { starRef?: string | null; positionRef?: string | null }[], field: 'starRef' | 'positionRef') {
    const validRaw = field === 'starRef' ? starRefsRaw : posRefsRaw;
    const validNorm = field === 'starRef' ? starRefsNorm : posRefsNorm;
    let rawMiss = 0;
    let recoveredByNorm = 0;
    let stillOrphan = 0;
    const stillOrphanExamples: string[] = [];
    const recoveredExamples: string[] = [];
    for (const row of rows) {
      const ref = row[field];
      if (!ref) continue;
      if (validRaw.has(ref)) continue; // matched by raw equality already — fine either way
      rawMiss++;
      const match = validNorm.get(normRef(ref));
      if (match) {
        recoveredByNorm++;
        if (recoveredExamples.length < 5) recoveredExamples.push(`"${ref}" → "${match}"`);
      } else {
        stillOrphan++;
        if (stillOrphanExamples.length < 5) stillOrphanExamples.push(`"${ref}"`);
      }
    }
    if (rawMiss === 0) {
      console.log(`${label}: all ${rows.length} rows matched by exact refCode. Nothing to report.`);
      return;
    }
    console.log(`${label}: ${rawMiss} of ${rows.length} rows didn't match by exact refCode.`);
    if (recoveredByNorm) console.log(`  → ${recoveredByNorm} recovered by trim+uppercase matching (e.g. ${recoveredExamples.join(', ')}).`);
    if (stillOrphan) console.log(`  → ${stillOrphan} STILL don't match anything, even normalized (e.g. ${stillOrphanExamples.join(', ')}) — genuine data gap, needs a manual look.`);
  }

  console.log('=== Ref-code join check (raw vs. normalized) ===\n');
  checkJoin('STAR → Position (stars.positionRef)', st, 'positionRef');
  checkJoin('Action → STAR (starActions.starRef)', actions, 'starRef');
  checkJoin('Result → STAR (starResults.starRef)', results, 'starRef');
  checkJoin('Responsibility → Position (responsibilities.positionRef)', resp, 'positionRef');
  checkJoin('Competence → STAR (starCompetences.starRef)', competences, 'starRef');
  checkJoin('Attribute → STAR (starAttributes.starRef)', attributes, 'starRef');
  let skillRawMiss = 0;
  let skillRecovered = 0;
  let skillStillOrphan = 0;
  const skillStillOrphanExamples: string[] = [];
  for (const sk of skills) {
    for (const ref of sk.starEvidence ?? []) {
      if (starRefsRaw.has(ref)) continue;
      skillRawMiss++;
      if (starRefsNorm.has(normRef(ref))) skillRecovered++;
      else {
        skillStillOrphan++;
        if (skillStillOrphanExamples.length < 5) skillStillOrphanExamples.push(`[${sk.refCode ?? sk.id}] "${ref}"`);
      }
    }
  }
  if (skillRawMiss === 0) {
    console.log('Skill → STAR (skillsMaster.starEvidence): all entries matched by exact refCode. Nothing to report.');
  } else {
    console.log(`Skill → STAR (skillsMaster.starEvidence): ${skillRawMiss} of the total star-evidence entries didn't match by exact refCode.`);
    if (skillRecovered) console.log(`  → ${skillRecovered} recovered by trim+uppercase matching.`);
    if (skillStillOrphan) {
      console.log(`  → ${skillStillOrphan} don't match by raw/normalized refCode (e.g. ${skillStillOrphanExamples.join(', ')}).`);
      console.log(
        '     NOTE: this check only tries raw and trim+uppercase matching — it does not know about the ' +
          '"STAR N" / "All STARs" / "All senior STARs" shorthand that buildGraphViewModel now parses, so a ' +
          "count here isn't a genuine-gap count. Trust Part 2 below (the real view-model output) for skills."
      );
    }
  }

  // ---------- Part 2: orphan nodes in the actual rendered graph ----------
  // Runs the real production view-model, so this matches what the graph shows —
  // not a re-implementation that could drift from it.
  const vm = buildGraphViewModel(graph);
  const touchedIds = new Set<string>();
  for (const l of vm.links) {
    touchedIds.add(typeof l.source === 'string' ? l.source : (l.source as { id: string }).id);
    touchedIds.add(typeof l.target === 'string' ? l.target : (l.target as { id: string }).id);
  }
  const orphansByType = new Map<string, { id: string; label: string }[]>();
  for (const n of vm.nodes) {
    if (touchedIds.has(n.id)) continue;
    if (!orphansByType.has(n.type)) orphansByType.set(n.type, []);
    orphansByType.get(n.type)!.push({ id: n.id, label: n.label });
  }

  console.log('\n=== Orphan nodes in the rendered graph (after the normalized-matching fix) ===\n');
  if (orphansByType.size === 0) {
    console.log('None — every node has at least one link.');
  } else {
    for (const [type, list] of orphansByType) {
      console.log(`${type}: ${list.length} orphan${list.length === 1 ? '' : 's'}`);
      for (const o of list.slice(0, 10)) console.log(`  - ${o.label}`);
      if (list.length > 10) console.log(`  ...and ${list.length - 10} more`);
    }
    console.log(
      '\nNote: a Position with no STARs/responsibilities recorded yet, or a STAR with no actions/results/' +
        'competences/attributes/skill-evidence recorded yet, is a genuine content gap in this profile — not a bug.'
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
