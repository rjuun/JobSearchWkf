'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { applications, cvVariants, jobLeads } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';
import type { EmailArtifactKind } from '@/lib/applications';
import * as monitoring from '@/lib/monitoring';

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
const ALLOWED_OUTCOMES = new Set([
  'response',
  'interview',
  'offer',
  'screened_out',
  'applied',
  'downloaded',
  'response_pending', // D-phase · set the moment "Application sent" fires
]);

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

// ── D-phase monitoring · CI Scoring Phase Redesign Part 2 (§2.2.B) ───────────
//
// Thin wrappers: resolve the owner from the session, delegate the write to
// lib/monitoring.ts, revalidate. The logic lives there because this is a
// `'use server'` module — every export here is a callable endpoint, so an
// owner-taking variant can't live in this file, and the verification harness
// (which has no request, hence no session) needs one it can drive.

function revalidateMonitoring(leadId: string): void {
  revalidatePath('/roleproof/applications');
  revalidatePath('/roleproof/archive');
  revalidatePath('/roleproof');
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/dashboard');
}

/** Stores an email dragged out of Outlook; returns the link for the DB column. */
export async function uploadEmailArtifactAction(
  leadId: string,
  kind: EmailArtifactKind,
  form: FormData
): Promise<string> {
  const owner = await currentOwnerId();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new Error('No file was dropped.');
  return monitoring.storeEmailArtifact(owner, leadId, kind, file);
}

export async function logApplicationSentAction(
  leadId: string,
  input: { confirmationEmailLink?: string | null } = {}
): Promise<void> {
  await monitoring.applicationSent(await currentOwnerId(), leadId, input);
  revalidateMonitoring(leadId);
}

export async function logDeclineAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date } = {}
): Promise<void> {
  await monitoring.decline(await currentOwnerId(), leadId, input);
  revalidateMonitoring(leadId);
}

export async function logInterviewScheduledAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date; interviewAt?: Date | null } = {}
): Promise<void> {
  await monitoring.interviewScheduled(await currentOwnerId(), leadId, input);
  revalidateMonitoring(leadId);
}

export async function setInterviewAtAction(leadId: string, interviewAt: Date | null): Promise<void> {
  await monitoring.setInterviewAt(await currentOwnerId(), leadId, interviewAt);
  revalidateMonitoring(leadId);
}
