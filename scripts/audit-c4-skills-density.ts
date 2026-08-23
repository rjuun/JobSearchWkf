/**
 * CI · C4 Skills Selection Produces Unreadable Overflow — before/after probe.
 *
 * Read-only. For every lead with Keep-gated rows, prints what C4 USED to
 * produce (every My Skills tag, uncapped) beside what it produces now
 * (`buildSkillsSection` over the Keep rows' Requirement Skills), plus how much
 * of the stored My Skills vocabulary the profile actually recognises.
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
import { buildVocabIndex, resolveVocab, buildSkillsSection } from '../lib/pipeline/skills';

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

    const section = buildSkillsSection(
      keep.map((g) => ({ rank: (g.requirementId && rankByReqId.get(g.requirementId)) ?? null, requirementSkills: g.requirementSkills ?? [] }))
    );
    const total = section.reduce((n, g) => n + g.items.length, 0);

    console.log(`\n${lead?.company ?? '?'} · ${lead?.title ?? '?'} [${leadId.slice(0, 8)}] — ${keep.length} Keep rows`);
    console.log(`  BEFORE (every My Skills tag, uncapped): ${rawTags.size} items in 1 line`);
    console.log(`  stored My Skills the profile recognises: ${recognised.length} / ${rawTags.size}`);
    console.log(`  AFTER  (Keep rows' Requirement Skills): ${total} items in ${section.length} categor${section.length === 1 ? 'y' : 'ies'}`);
    for (const g of section) console.log(`    ${g.category}: ${g.items.join(' · ')}`);
  }
  process.exit(0);
}
main();
