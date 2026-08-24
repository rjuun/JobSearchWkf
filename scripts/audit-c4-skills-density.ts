/**
 * CI · C4 Skills Selection Produces Unreadable Overflow — before/after probe.
 *
 * Read-only. For every lead with Keep-gated rows, prints what C4 USED to
 * produce (every My Skills tag, uncapped) beside what it produces now
 * (`buildSkillsSection` over the Keep rows' `cv_bullet_skills`), how much of
 * the stored My Skills vocabulary the profile actually recognises, and the
 * coverage gap the column split makes computable: Requirement Skills the JD
 * asked for that no Keep bullet ended up displaying.
 *
 * Stored My Skills on leads mapped before this CI are still the old free-text
 * graph tags — they are rewritten the next time C2 runs for that lead.
 *
 *   npx tsx scripts/audit-c4-skills-density.ts
 */
import './_env';
import { db } from '../lib/db';
import { requirementTailoring, jobRequirements, jobLeads } from '../lib/db/schema';
import { gatherSkillVocabulary } from '../lib/pipeline/tailoring';
import { buildVocabIndex, resolveVocab, prioritiseSkills } from '../lib/pipeline/skills';

async function main() {
  const rows = await db.select().from(requirementTailoring);
  const leads = await db.select().from(jobLeads);
  const reqs = await db.select().from(jobRequirements);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const rankByReqId = new Map(reqs.map((r) => [r.id, r.rank]));

  const byLead = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.jobLeadId || r.approvalStatus !== 'green') continue;
    if (!byLead.has(r.jobLeadId)) byLead.set(r.jobLeadId, [] as typeof rows);
    byLead.get(r.jobLeadId)!.push(r);
  }

  for (const [leadId, keep] of byLead) {
    const lead = leadById.get(leadId);
    const owner = keep[0].ownerId;
    const index = buildVocabIndex(await gatherSkillVocabulary(owner));

    const rawTags = new Set<string>();
    for (const r of keep) for (const n of r.mySkills ?? []) if (n) rawTags.add(n);
    const recognised = resolveVocab([...rawTags], index);

    // Selection + prioritisation only. Categorisation is a model call now
    // (C4 §B.1), so a read-only probe cannot reproduce it — and shouldn't
    // pretend to by inventing headings offline.
    const selected = prioritiseSkills(
      keep.map((g) => ({ rank: (g.requirementId && rankByReqId.get(g.requirementId)) ?? null, cvBulletSkills: g.cvBulletSkills ?? [] }))
    );
    const total = selected.length;

    console.log(`\n${lead?.company ?? '?'} · ${lead?.title ?? '?'} [${leadId.slice(0, 8)}] — ${keep.length} Keep rows`);
    console.log(`  BEFORE (every My Skills tag, uncapped): ${rawTags.size} items in 1 line`);
    console.log(`  stored My Skills the profile recognises: ${recognised.length} / ${rawTags.size}`);
    console.log(`  AFTER  (Keep rows' cv_bullet_skills, prioritised): ${total} items — categories are assigned by C4's grouping call at generate time`);
    console.log(`    ${selected.join(' · ')}`);

    // CI · Split cv_bullet_skills from requirement_skills — only computable
    // once C3's tag stopped overwriting B2's asks.
    const asked = new Set<string>();
    const shown = new Set<string>();
    for (const r of keep) {
      for (const n of r.requirementSkills ?? []) if (n) asked.add(n.trim().toLowerCase());
      for (const n of r.cvBulletSkills ?? []) if (n) shown.add(n.trim().toLowerCase());
    }
    const gap = [...asked].filter((n) => !shown.has(n));
    // Exact string match, and it OVER-REPORTS: C3 rewords most asks
    // ("Stakeholder management" -> "Stakeholder Management With Senior
    // Leadership"), which scores as a miss here. Read it as "not matched
    // literally", not "not evidenced" — see CI · Skill Name Treatment in the
    // C4 Skills Section.
    console.log(`  NOT MATCHED LITERALLY (exact-string; over-reports where C3 reworded): ${gap.length} of ${asked.size}`);
    if (gap.length) console.log(`    ${gap.sort().join(' · ')}`);
  }
  process.exit(0);
}
main();
