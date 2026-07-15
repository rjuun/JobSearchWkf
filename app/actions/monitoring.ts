'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { applications, cvVariants, jobLeads } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';

/**
 * D-phase scaffold — once a CV is ready, record the application and start
 * tracking it. Links the application to the CV variant generated for this lead
 * (so we know which tailored CV went out) and moves the lead to `applied`.
 */
export async function markAppliedAction(leadId: string): Promise<void> {
  const owner = await currentOwnerId();
  const cvPath = `cv-output/${leadId}/tailored.docx`;
  const [lead] = await db.select({ id: jobLeads.id }).from(jobLeads).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const [variant] = await db
    .select()
    .from(cvVariants)
    .where(and(eq(cvVariants.storagePath, cvPath), eq(cvVariants.ownerId, owner)))
    .limit(1);
  // Idempotent upsert on the (owner, lead) unique index — no select-then-insert
  // race, no duplicate rows. Preserves the original applied date and, unless a new
  // CV variant was found, the existing one.
  await db
    .insert(applications)
    .values({ ownerId: owner, jobLeadId: leadId, cvVariantId: variant?.id ?? null, appliedAt: new Date(), status: 'applied' })
    .onConflictDoUpdate({
      target: [applications.ownerId, applications.jobLeadId],
      set: {
        status: 'applied',
        appliedAt: sql`coalesce(${applications.appliedAt}, now())`,
        ...(variant?.id ? { cvVariantId: variant.id } : {}),
      },
    });
  await db.update(jobLeads).set({ status: 'applied' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  await recordActivity(owner, 'applied', { leadId, summary: 'Sent an application' });
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/roleproof');
  revalidatePath('/dashboard');
}

// The outcomes the Returns control can set — guarded server-side so a direct
// action call can't write an arbitrary status into the Returns/Statement data.
const ALLOWED_OUTCOMES = new Set(['response', 'interview', 'offer', 'screened_out', 'applied', 'downloaded']);

/** Record an interview/offer/rejection outcome on the latest application. */
export async function recordOutcomeAction(leadId: string, status: string, notes?: string): Promise<void> {
  if (!ALLOWED_OUTCOMES.has(status)) return;
  const owner = await currentOwnerId();
  const [app] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, owner)))
    .orderBy(desc(applications.createdAt))
    .limit(1);
  if (!app) return;
  await db
    .update(applications)
    .set({ status, outcomeNotes: notes ?? app.outcomeNotes ?? null })
    .where(and(eq(applications.id, app.id), eq(applications.ownerId, owner)));
  // B2 reaction signal + statement line: the whole outcome loop hinges on whether
  // users actually log returns, so record that they did.
  await recordActivity(owner, 'outcome', { leadId, summary: `Logged an outcome: ${status}` });
  await recordUxEvent(owner, 'returns', 'outcome_logged', { leadId, meta: { status } });
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/dashboard');
}
