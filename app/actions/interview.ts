'use server';

/**
 * R1 · Interview Armament — the read-only projection behind the night-before
 * brief. No new data: it owner-scopes the lead (via `getLead`) then re-projects
 * its requirements + C2 tailoring through the pure `buildInterviewBrief`. Reads
 * only; the page emits the `interview_brief · open` reaction signal.
 */
import { getLead, getRequirements, getTailoring } from '@/lib/queries';
import { buildInterviewBrief, type InterviewBrief } from '@/lib/interview';

export type LoadedInterviewBrief = {
  lead: { id: string; title: string; company: string | null };
  brief: InterviewBrief;
} | null;

export async function loadInterviewBrief(leadId: string): Promise<LoadedInterviewBrief> {
  const lead = await getLead(leadId);
  if (!lead) return null;

  const [reqs, rows] = await Promise.all([getRequirements(leadId), getTailoring(leadId)]);
  const brief = buildInterviewBrief(
    reqs.map((r) => ({
      requirement: r.requirement,
      rank: r.rank,
      description: r.description,
      initialMatchStrength: r.initialMatchStrength,
    })),
    rows.map((t) => ({
      requirementLine: t.requirementLine,
      cvBullet: t.cvBullet,
      originalText: t.originalText,
      evidenceRef: t.evidenceRef,
      connectionToExpertise: t.connectionToExpertise,
      approvalStatus: t.approvalStatus,
    }))
  );

  return { lead: { id: lead.id, title: lead.title, company: lead.company }, brief };
}
