'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { applications, cvVariants, jobLeads } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { recordActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';
import { writeBuffer } from '@/lib/storage';
import {
  emailArtifactLink,
  emailArtifactObjectName,
  emailArtifactPath,
  type EmailArtifactKind,
} from '@/lib/applications';

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
// Three actions, one per drop target. Each mirrors markAppliedAction's idempotent
// onConflictDoUpdate rather than select-then-update, so a double-drop can't
// duplicate a row, and each still emits the `returns`/`outcome_logged` UX event
// the retired Returns panel used to emit — the Statement must not lose that
// signal just because the surface behind it changed (§2.2.G).

async function ownedLead(leadId: string, owner: string): Promise<{ id: string; title: string; company: string | null }> {
  const [lead] = await db
    .select({ id: jobLeads.id, title: jobLeads.title, company: jobLeads.company })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  return lead;
}

function revalidateMonitoring(leadId: string): void {
  revalidatePath('/roleproof/applications');
  revalidatePath('/roleproof/archive');
  revalidatePath('/roleproof');
  revalidatePath(`/roleproof/leads/${leadId}`);
  revalidatePath('/dashboard');
}

/**
 * Stores an email dragged out of Outlook onto one of the three drop targets and
 * returns the link to put in confirmationEmailLink/outcomeEmailLink. Separate
 * from the log actions on purpose (§2.2.C's handler uploads, *then* links) so a
 * text-link or empty drop skips this entirely.
 */
export async function uploadEmailArtifactAction(
  leadId: string,
  kind: EmailArtifactKind,
  form: FormData
): Promise<string> {
  const owner = await currentOwnerId();
  await ownedLead(leadId, owner);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new Error('No file was dropped.');
  const objectName = emailArtifactObjectName(kind, file.name);
  await writeBuffer(emailArtifactPath(leadId, objectName), Buffer.from(await file.arrayBuffer()));
  return emailArtifactLink(leadId, objectName);
}

/**
 * "Application sent" (§2.2.H) — fired by dropping the confirmation email on the
 * Results row, or by the manual-confirm fallback when there is no email to drop
 * (a portal application). The lead itself moves to `applied` and stays there for
 * the whole D-phase; the sub-states live on `applications.status` (§2.2.A).
 */
export async function logApplicationSentAction(
  leadId: string,
  input: { confirmationEmailLink?: string | null } = {}
): Promise<void> {
  const owner = await currentOwnerId();
  const lead = await ownedLead(leadId, owner);
  const link = input.confirmationEmailLink ?? null;
  await db
    .insert(applications)
    .values({
      ownerId: owner,
      jobLeadId: leadId,
      appliedAt: new Date(),
      status: 'response_pending',
      confirmationEmailLink: link,
    })
    .onConflictDoUpdate({
      target: [applications.ownerId, applications.jobLeadId],
      set: {
        status: 'response_pending',
        // Preserve the original send date — a re-drop is a correction of the
        // link, not a claim that the application went out again today.
        appliedAt: sql`coalesce(${applications.appliedAt}, now())`,
        updatedAt: new Date(),
        ...(link ? { confirmationEmailLink: link } : {}),
      },
    });
  await db.update(jobLeads).set({ status: 'applied', updatedAt: new Date() }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  await recordActivity(owner, 'applied', { leadId, summary: `Application sent · “${lead.title}”` });
  await recordUxEvent(owner, 'returns', 'outcome_logged', { leadId, meta: { status: 'response_pending' } });
  revalidateMonitoring(leadId);
}

/**
 * Decline (§2.2.E) — the status change and the Archive move happen here, with no
 * extra click. The reply-assist pop-up is client-side and fires *after* this
 * resolves; skipping it undoes nothing.
 */
export async function logDeclineAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date } = {}
): Promise<void> {
  const owner = await currentOwnerId();
  const lead = await ownedLead(leadId, owner);
  const link = input.outcomeEmailLink ?? null;
  const at = input.outcomeAt ?? new Date();
  await db
    .insert(applications)
    .values({ ownerId: owner, jobLeadId: leadId, appliedAt: new Date(), status: 'screened_out', outcomeEmailLink: link, outcomeAt: at })
    .onConflictDoUpdate({
      target: [applications.ownerId, applications.jobLeadId],
      set: {
        status: 'screened_out',
        appliedAt: sql`coalesce(${applications.appliedAt}, now())`,
        outcomeAt: at,
        updatedAt: new Date(),
        ...(link ? { outcomeEmailLink: link } : {}),
      },
    });
  await recordActivity(owner, 'outcome', { leadId, summary: `Application stopped · “${lead.title}”` });
  await recordUxEvent(owner, 'returns', 'outcome_logged', { leadId, meta: { status: 'screened_out' } });
  revalidateMonitoring(leadId);
}

/**
 * Interview scheduled (§2.2.D). `outcomeAt` is the setup date (when the invite
 * landed); `interviewAt` is the interview itself — the one field no dropped
 * email carries, so it is always typed by hand.
 */
export async function logInterviewScheduledAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date; interviewAt?: Date | null } = {}
): Promise<void> {
  const owner = await currentOwnerId();
  const lead = await ownedLead(leadId, owner);
  const link = input.outcomeEmailLink ?? null;
  const at = input.outcomeAt ?? new Date();
  await db
    .insert(applications)
    .values({
      ownerId: owner,
      jobLeadId: leadId,
      appliedAt: new Date(),
      status: 'interview',
      outcomeEmailLink: link,
      outcomeAt: at,
      interviewAt: input.interviewAt ?? null,
    })
    .onConflictDoUpdate({
      target: [applications.ownerId, applications.jobLeadId],
      set: {
        status: 'interview',
        appliedAt: sql`coalesce(${applications.appliedAt}, now())`,
        outcomeAt: at,
        updatedAt: new Date(),
        ...(link ? { outcomeEmailLink: link } : {}),
        ...(input.interviewAt !== undefined ? { interviewAt: input.interviewAt } : {}),
      },
    });
  await recordActivity(owner, 'outcome', { leadId, summary: `Interview scheduled · “${lead.title}”` });
  await recordUxEvent(owner, 'returns', 'outcome_logged', { leadId, meta: { status: 'interview' } });
  revalidateMonitoring(leadId);
}

/**
 * The interview date/time picker on an existing `interview` row. Split from the
 * action above because the invite arrives (drop) and the date gets pinned down
 * (typing) at different moments — often days apart.
 */
export async function setInterviewAtAction(leadId: string, interviewAt: Date | null): Promise<void> {
  const owner = await currentOwnerId();
  await ownedLead(leadId, owner);
  await db
    .update(applications)
    .set({ interviewAt, updatedAt: new Date() })
    .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, owner)));
  revalidateMonitoring(leadId);
}
