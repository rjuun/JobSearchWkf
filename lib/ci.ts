/**
 * Continuous-improvement loop. Two directions:
 *   ciGuidanceFor(step) — unresolved accuracy tips are injected into the relevant
 *     step's system prompt, so a correction the user records once shapes every
 *     future run of that step (the methodology's feedback loop).
 *   recordGapTips(...)  — when C2 can't honestly evidence a requirement, it logs
 *     a Profile-Update tip, which both surfaces on the Career Graph and feeds the
 *     guidance above. The loop closes.
 */
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { accuracyTips } from './db/schema';

/** Active operator guidance to append to a step's system prompt (or ''). */
export async function ciGuidanceFor(step: string, ownerId?: string | null): Promise<string> {
  const tips = await db
    .select()
    .from(accuracyTips)
    .where(
      ownerId
        ? and(eq(accuracyTips.ownerId, ownerId), eq(accuracyTips.resolved, false))
        : eq(accuracyTips.resolved, false)
    );
  const s = step.toLowerCase();
  const relevant = tips.filter((t) => {
    const w = (t.whereApplies ?? '').toLowerCase().trim();
    return w === '' || w.includes('all') || w.includes('global') || w.includes(s);
  });
  if (relevant.length === 0) return '';
  const lines = relevant
    .slice(0, 12)
    .map((t) => `- [${t.type ?? 'Note'}] ${t.observation}${t.suggestedAction ? ` → ${t.suggestedAction}` : ''}`);
  return `\n\n--- OPERATOR GUIDANCE FROM PAST FEEDBACK (apply where relevant; never let it override truthfulness) ---\n${lines.join('\n')}`;
}

/** Replace this lead's C2-generated gap tips with a fresh set (idempotent). */
export async function recordGapTips(
  leadId: string,
  ownerId: string | null,
  gaps: { requirement?: string | null; note: string }[]
): Promise<void> {
  await db
    .delete(accuracyTips)
    .where(
      and(
        eq(accuracyTips.jobLeadId, leadId),
        eq(accuracyTips.whereApplies, 'C2'),
        ownerId ? eq(accuracyTips.ownerId, ownerId) : eq(accuracyTips.jobLeadId, leadId)
      )
    );
  const rows = gaps
    .filter((g) => g.requirement || g.note)
    .slice(0, 20)
    .map((g) => ({
      ownerId: ownerId ?? undefined,
      jobLeadId: leadId,
      type: 'Profile Update',
      observation: g.requirement ? `No strong evidence for requirement: "${g.requirement}"` : g.note,
      suggestedAction: 'Add or strengthen evidence in your Career Graph so this requirement can be backed.',
      whereApplies: 'C2',
    }));
  if (rows.length) await db.insert(accuracyTips).values(rows);
}
