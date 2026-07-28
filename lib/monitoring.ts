/**
 * The D-phase write path (CI · Scoring Phase Redesign Part 2, §2.2.B).
 *
 * These live here rather than inside app/actions/monitoring.ts because that's a
 * `'use server'` module: everything it exports becomes a callable endpoint, so
 * an `owner`-taking variant can't live there without handing the client the
 * ability to name whose row it writes. The actions resolve the owner from the
 * session and delegate here; this module is also what the verification harness
 * drives, since `currentOwnerId()` needs a request and a script has none.
 *
 * Every write is an idempotent upsert on the `(owner, lead)` unique index — the
 * same shape markAppliedAction has used since it was written, so a double-drop
 * corrects a row rather than duplicating it.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { applications, jobLeads } from './db/schema';
import { recordActivity } from './activity';
import { recordUxEvent } from './ux-events';
import { writeBuffer } from './storage';
import { emailArtifactLink, emailArtifactObjectName, emailArtifactPath, type EmailArtifactKind } from './applications';

export type OwnedLead = { id: string; title: string; company: string | null };

/** Owner-scoped existence check — every entry point starts here. */
export async function requireLead(owner: string, leadId: string): Promise<OwnedLead> {
  const [lead] = await db
    .select({ id: jobLeads.id, title: jobLeads.title, company: jobLeads.company })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  return lead;
}

/** Stores a dropped email and returns the href to put in the link column. */
export async function storeEmailArtifact(
  owner: string,
  leadId: string,
  kind: EmailArtifactKind,
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<string> {
  await requireLead(owner, leadId);
  const objectName = emailArtifactObjectName(kind, file.name);
  await writeBuffer(emailArtifactPath(leadId, objectName), Buffer.from(await file.arrayBuffer()));
  return emailArtifactLink(leadId, objectName);
}

/**
 * "Application sent" (§2.2.H). The lead itself moves to `applied` and stays
 * there for the whole D-phase — the sub-states live on `applications.status`,
 * so every board consumer keys off one unchanged field (§2.2.A).
 */
export async function applicationSent(
  owner: string,
  leadId: string,
  input: { confirmationEmailLink?: string | null } = {}
): Promise<void> {
  const lead = await requireLead(owner, leadId);
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
        // Preserve the original send date — a re-drop corrects the link, it
        // doesn't claim the application went out again today.
        appliedAt: sql`coalesce(${applications.appliedAt}, now())`,
        updatedAt: new Date(),
        ...(link ? { confirmationEmailLink: link } : {}),
      },
    });
  await db
    .update(jobLeads)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  await recordActivity(owner, 'applied', { leadId, summary: `Application sent · “${lead.title}”` });
  await recordUxEvent(owner, 'returns', 'outcome_logged', { leadId, meta: { status: 'response_pending' } });
}

/**
 * Decline (§2.2.E). The status change and the Archive move happen here with no
 * extra click; the reply-assist pop-up is client-side and fires after.
 */
export async function decline(
  owner: string,
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date } = {}
): Promise<void> {
  const lead = await requireLead(owner, leadId);
  const link = input.outcomeEmailLink ?? null;
  const at = input.outcomeAt ?? new Date();
  await db
    .insert(applications)
    .values({
      ownerId: owner,
      jobLeadId: leadId,
      appliedAt: new Date(),
      status: 'screened_out',
      outcomeEmailLink: link,
      outcomeAt: at,
    })
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
}

/**
 * Interview scheduled (§2.2.D). `outcomeAt` is when the invite landed;
 * `interviewAt` is the interview itself — the one field no dropped email
 * carries, so it's typed by hand and often only later.
 */
export async function interviewScheduled(
  owner: string,
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date; interviewAt?: Date | null } = {}
): Promise<void> {
  const lead = await requireLead(owner, leadId);
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
}

/** The interview date/time picker on an existing `interview` row. */
export async function setInterviewAt(owner: string, leadId: string, interviewAt: Date | null): Promise<void> {
  await requireLead(owner, leadId);
  await db
    .update(applications)
    .set({ interviewAt, updatedAt: new Date() })
    .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, owner)));
}
