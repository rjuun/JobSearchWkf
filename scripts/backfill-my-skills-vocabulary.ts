/**
 * Resolve stored `requirement_tailoring.my_skills` through the owner's curated
 * vocabulary — CI · C4 Skills Selection Produces Unreadable Overflow.
 *
 * Why this exists. C2 used to copy the evidence node's own free-text Career
 * Graph tags into `my_skills`; since the vocabulary gate it selects from
 * `skills_master` / `star_competences` / `star_attributes` and drops anything
 * those tables do not recognise. Rows mapped before the gate keep the old
 * values, and re-running C2 does NOT fix them: `planMerge` writes `my_skills`
 * only on the `toReplace` path (new evidence scoring strictly higher), so a
 * re-run that proposes the same refs at the same strengths leaves every row in
 * `unchanged` and touches nothing.
 *
 * What it does. Exactly what C2 now does at write time, applied to what is
 * already stored: `resolveVocab` against the same index C2 builds. That returns
 * the profile's own spelling — so a stored ATS variant is canonicalised too —
 * and drops what the profile does not recognise.
 *
 * Why dropping is right, and not merely defensible: an unrecognised value is not
 * provenance, it is noise wearing provenance's clothes. "Data Reliability" as a
 * My Skill is a claim the profile does not make. An empty list is the true
 * statement that no curated capability was recorded for that row. This CI exists
 * because free-text tags masquerading as curated vocabulary put 67 skills on a
 * CV. The raw tags remain on the Career Graph, which is where they belong.
 *
 * Deterministic, no model call, and idempotent — a second run resolves values
 * that are already canonical to themselves and reports zero changes.
 *
 * Report-only by default; --apply writes.
 *
 *   npx tsx scripts/backfill-my-skills-vocabulary.ts            # dry run
 *   npx tsx scripts/backfill-my-skills-vocabulary.ts --apply    # writes
 */
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { requirementTailoring, jobLeads } from '../lib/db/schema';
import { gatherSkillVocabulary } from '../lib/pipeline/tailoring';
import { buildVocabIndex, resolveVocab } from '../lib/pipeline/skills';

const APPLY = process.argv.includes('--apply');
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function main() {
  const rows = await db.select().from(requirementTailoring);
  const leads = await db.select().from(jobLeads);
  const leadById = new Map(leads.map((l) => [l.id, l]));

  // One index per owner — the vocabulary is owner-scoped, and so is the fix.
  const indexByOwner = new Map<string, Awaited<ReturnType<typeof buildVocabIndex>>>();
  const indexFor = async (ownerId: string) => {
    let idx = indexByOwner.get(ownerId);
    if (!idx) {
      idx = buildVocabIndex(await gatherSkillVocabulary(ownerId));
      indexByOwner.set(ownerId, idx);
    }
    return idx;
  };

  type Change = { id: string; before: string[]; after: string[] };
  const byLead = new Map<string, Change[]>();
  // `unrecognised` and `collapsed` are counted separately on purpose. A naive
  // before-minus-after conflates them, and they mean opposite things: a dropped
  // value is data the profile does not recognise, while a collapsed one is two
  // ATS variants of the SAME skill merging to its canonical name — a gain, not a
  // loss. Reporting 146 "unrecognised" instead of 137 + 9 overstates what the
  // owner is being asked to accept.
  type Stat = { rows: number; values: number; unrecognised: number; collapsed: number; emptied: number; changed: number };
  const stats = new Map<string, Stat>();

  for (const row of rows) {
    const before = (row.mySkills ?? []).filter(Boolean);
    const leadId = row.jobLeadId ?? '(no lead)';
    const s = stats.get(leadId) ?? { rows: 0, values: 0, unrecognised: 0, collapsed: 0, emptied: 0, changed: 0 };
    if (before.length === 0) { stats.set(leadId, s); continue; }
    const index = await indexFor(row.ownerId);
    const after = resolveVocab(before, index);
    // Resolve each value alone to tell "the profile does not know this" from
    // "this is another spelling of one already counted".
    const recognised = before.filter((v) => resolveVocab([v], index).length > 0).length;
    s.rows += 1;
    s.values += before.length;
    s.unrecognised += before.length - recognised;
    s.collapsed += recognised - after.length;
    if (after.length === 0) s.emptied += 1;
    if (!same(before, after)) {
      s.changed += 1;
      if (!byLead.has(leadId)) byLead.set(leadId, []);
      byLead.get(leadId)!.push({ id: row.id, before, after });
    }
    stats.set(leadId, s);
  }

  console.log(APPLY ? '=== APPLYING ===\n' : '=== DRY RUN (pass --apply to write) ===\n');
  console.log('lead                                      rows  values  dropped  collapsed  ->empty  changed');
  let totalChanged = 0;
  for (const [leadId, s] of [...stats.entries()].sort((a, b) => b[1].unrecognised - a[1].unrecognised)) {
    const l = leadById.get(leadId);
    const label = `${(l?.company ?? '?').slice(0, 22).padEnd(22)} ${leadId.slice(0, 8)}`;
    console.log(
      `${label.padEnd(40)} ${String(s.rows).padStart(4)}  ${String(s.values).padStart(6)}  ${String(s.unrecognised).padStart(7)}  ${String(s.collapsed).padStart(9)}  ${String(s.emptied).padStart(7)}  ${String(s.changed).padStart(7)}`
    );
    totalChanged += s.changed;
  }
  console.log(`\nrows that would change: ${totalChanged}`);

  const sample = [...byLead.values()].flat().slice(0, 6);
  if (sample.length) {
    console.log('\nsample:');
    for (const c of sample) console.log(`  [${c.before.join(', ')}]\n    -> [${c.after.join(', ')}]`);
  }

  if (!APPLY) { console.log('\nReport only. Nothing written.'); process.exit(0); }

  for (const change of [...byLead.values()].flat()) {
    await db.update(requirementTailoring).set({ mySkills: change.after }).where(eq(requirementTailoring.id, change.id));
  }
  console.log(`\nApplied: ${totalChanged} row(s) rewritten.`);
  process.exit(0);
}
main();
