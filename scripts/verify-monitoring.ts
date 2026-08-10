/**
 * Acceptance verification for CI · Scoring Phase Redesign — Part 2 (§2.4).
 *
 * Runs against the real DB under a throwaway owner id, building the exact
 * application shapes each criterion needs (freshly sent / stale / declined /
 * interview) rather than hoping real data contains them. Everything it creates —
 * DB rows *and* stored files — it deletes; see cleanup() and the finally block.
 *
 * LLM_MODE is forced to mock (./_force-mock must stay the first import — see
 * Part 1's §4 log for why an inline `process.env.LLM_MODE = 'mock'` silently
 * does nothing). Nothing here calls a model; the guard is belt-and-braces so a
 * stray pipeline import can't start spending money.
 *
 * The one criterion no harness can prove is the live drag-and-drop out of
 * Outlook Classic (§2.3 step 13) — that needs a real .msg dragged onto each of
 * the three targets by hand.
 */
import './_force-mock';
import './_env';
import fs from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { applications, jobLeads } from '../lib/db/schema';
import { exists, localPath, readBuffer, writeBuffer } from '../lib/storage';
import {
  ARCHIVED_APPLICATION_STATUS,
  OPEN_APPLICATION_STATUSES,
  applicationStatusLabel,
  emailArtifactLink,
  emailArtifactObjectName,
  emailArtifactPath,
  isStaleApplication,
} from '../lib/applications';
import {
  applicationSent,
  decline,
  interviewScheduled,
  setInterviewAt,
  storeEmailArtifact,
} from '../lib/monitoring';
import { parseEmailArtifact } from '../lib/email-parse';

const OWNER = '00000000-0000-0000-0000-0000000ffff2'; // throwaway, not DEMO_OWNER_ID

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

const createdLeads: string[] = [];

async function makeLead(title: string, status: 'ready' | 'applied' = 'ready'): Promise<string> {
  const [row] = await db
    .insert(jobLeads)
    .values({ ownerId: OWNER, title, company: 'Testhaus GmbH', status, jdText: 'x' })
    .returning({ id: jobLeads.id });
  createdLeads.push(row.id);
  return row.id;
}

async function cleanup(): Promise<void> {
  if (createdLeads.length) {
    await db.delete(applications).where(inArray(applications.jobLeadId, createdLeads));
    await db.delete(jobLeads).where(inArray(jobLeads.id, createdLeads));
    for (const id of createdLeads) {
      await fs.rm(localPath(`applications/${id}`), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** §2.3 step 3 — the applications/{leadId}/ prefix against the real adapter. */
async function checkStoragePrefix(): Promise<void> {
  console.log('\n§2.3 step 3 · storage prefix');
  const leadId = await makeLead('Storage probe');
  const objectName = emailArtifactObjectName('confirmation', 'Re Your application.msg');
  const rel = emailArtifactPath(leadId, objectName);

  check('object name is timestamped and keeps the .msg extension', /^confirmation-.+\.msg$/.test(objectName), objectName);
  check('path sits under the new applications/ prefix', rel === `applications/${leadId}/${objectName}`, rel);

  // A CDFV2 compound-binary header — the real first bytes of an Outlook .msg.
  const body = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 7)]);
  await writeBuffer(rel, body);
  check('writeBuffer accepted the new prefix', await exists(rel));
  const back = await readBuffer(rel);
  check('readBuffer round-trips the bytes unchanged', Buffer.compare(back, body) === 0, `${back.length} bytes`);
  check(
    'the link column value is an href into this app',
    emailArtifactLink(leadId, objectName) === `/api/applications/${leadId}/email/${encodeURIComponent(objectName)}`
  );

  const other = await makeLead('Storage probe 2');
  await writeBuffer(emailArtifactPath(other, objectName), body);
  check('two leads with the same object name do not collide', await exists(emailArtifactPath(other, objectName)));
}

/** §2.4 — the label map and the stale rule, over the exact statuses in play. */
async function checkLabelsAndStale(): Promise<void> {
  console.log('\n§2.4 · labels and the stale badge');
  check('response_pending reads "Response pending"', applicationStatusLabel('response_pending') === 'Response pending');
  check('interview reads "Interview scheduled"', applicationStatusLabel('interview') === 'Interview scheduled');
  check('screened_out reads "Stopped"', applicationStatusLabel('screened_out') === 'Stopped');

  const old = new Date(Date.now() - 9 * 86_400_000);
  const recent = new Date(Date.now() - 2 * 86_400_000);
  check('9-day-old response_pending is stale', isStaleApplication({ status: 'response_pending', appliedAt: old, updatedAt: old }));
  check('2-day-old response_pending is not stale', !isStaleApplication({ status: 'response_pending', appliedAt: recent, updatedAt: recent }));
  check(
    'a 9-day-old row touched yesterday is not stale',
    !isStaleApplication({ status: 'response_pending', appliedAt: old, updatedAt: new Date(Date.now() - 86_400_000) })
  );
  check('an interview row is never stale', !isStaleApplication({ status: 'interview', appliedAt: old, updatedAt: old }));
}

/**
 * The extraction that used to be phase-2 (§2.0) — a decline/interview drop
 * now reads its own date and sender out of the file instead of defaulting to
 * "today, no address". Two things worth getting wrong here: a garbage-content
 * `.msg` (real header, fake body — `droppedMsg` below) must fail *silently*,
 * not throw and break the whole drop; a real `.eml` must actually parse.
 */
function checkEmailParsing(): void {
  console.log('\n· email-date/sender extraction (lib/email-parse.ts)');

  const garbageMsg = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 3)]);
  const fromGarbage = parseEmailArtifact(garbageMsg, 'Absage.msg');
  check('a malformed .msg parses to nulls, not a throw', fromGarbage.date === null && fromGarbage.senderEmail === null);

  const eml = [
    'From: "Hoerbiger HR" <system@successfactors.eu>',
    'To: candidate@example.com',
    'Subject: Your application',
    'Date: Wed, 22 Oct 2025 14:03:00 +0200',
    '',
    'We have decided to proceed with other candidates.',
  ].join('\r\n');
  const fromEml = parseEmailArtifact(Buffer.from(eml, 'utf8'), 'Absage.eml');
  check('.eml sender is the address, not the display name', fromEml.senderEmail === 'system@successfactors.eu', String(fromEml.senderEmail));
  check(
    '.eml date is the email\'s own Date header, not today',
    fromEml.date?.toISOString() === new Date('2025-10-22T12:03:00Z').toISOString(),
    fromEml.date?.toISOString()
  );

  const unknownExt = parseEmailArtifact(Buffer.from('irrelevant'), 'Absage.pdf');
  check('an unparseable extension yields nulls, not a guess', unknownExt.date === null && unknownExt.senderEmail === null);
}

/** A stand-in for the browser's File — same two members storeEmailArtifact uses. */
function droppedMsg(name: string) {
  const bytes = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64, 3)]);
  return {
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/** A real, parseable dropped email — proves the end-to-end path, not just the parser in isolation. */
function droppedEml(name: string, dateHeader: string, from: string) {
  const text = [`From: ${from}`, 'To: candidate@example.com', 'Subject: Your application', `Date: ${dateHeader}`, '', 'Body.'].join(
    '\r\n'
  );
  const bytes = Buffer.from(text, 'utf8');
  return {
    name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function appRow(leadId: string) {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, OWNER)));
  return row;
}

/** §2.4 — the drop on the Results/board "Application sent" control. */
async function checkApplicationSent(): Promise<void> {
  console.log('\n§2.4 · dropping a confirmation email');
  const leadId = await makeLead('Sent by drop');
  const { link } = await storeEmailArtifact(OWNER, leadId, 'confirmation', droppedMsg('Bestätigung.msg'));
  await applicationSent(OWNER, leadId, { confirmationEmailLink: link });

  const row = await appRow(leadId);
  check('status is response_pending', row?.status === 'response_pending', String(row?.status));
  check('appliedAt was set with no manual entry', !!row?.appliedAt);
  check('confirmationEmailLink resolves to the archived copy', row?.confirmationEmailLink === link, link);
  const object = link.split('/').pop()!;
  check('the archived copy is really in storage', await exists(emailArtifactPath(leadId, decodeURIComponent(object))));

  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  check('the lead itself moved to applied and stays there', lead.status === 'applied', lead.status);

  // The no-email fallback, on a second lead.
  const portalId = await makeLead('Portal application, no email');
  await applicationSent(OWNER, portalId, {});
  const portal = await appRow(portalId);
  check('manual confirm reaches the same status', portal?.status === 'response_pending');
  check('…with no link, rather than an empty string', portal?.confirmationEmailLink === null);

  // A second drop must correct the row, not duplicate it (unique index + upsert).
  const firstSentAt = row?.appliedAt?.getTime();
  const { link: link2 } = await storeEmailArtifact(OWNER, leadId, 'confirmation', droppedMsg('Bestätigung-korrigiert.msg'));
  await applicationSent(OWNER, leadId, { confirmationEmailLink: link2 });
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, OWNER)));
  check('re-dropping does not create a second row', rows.length === 1, `${rows.length} row(s)`);
  check('re-dropping replaces the link', rows[0].confirmationEmailLink === link2);
  check('re-dropping preserves the original send date', rows[0].appliedAt?.getTime() === firstSentAt);
}

/** §2.4 — decline drop: status, columns, and the move out of the list. */
async function checkDecline(): Promise<void> {
  console.log('\n§2.4 · dropping a decline');
  const leadId = await makeLead('Declined');
  await applicationSent(OWNER, leadId, {});
  const { link } = await storeEmailArtifact(OWNER, leadId, 'decline', droppedMsg('Absage.msg'));
  const at = new Date('2026-07-20T09:00:00Z');
  await decline(OWNER, leadId, { outcomeEmailLink: link, outcomeAt: at });

  const row = await appRow(leadId);
  check('status is screened_out', row?.status === 'screened_out', String(row?.status));
  check('outcomeEmailLink points at the archived decline', row?.outcomeEmailLink === link);
  check('outcomeAt records the decline date', row?.outcomeAt?.toISOString() === at.toISOString());
  check('the send date survives the decline', !!row?.appliedAt);

  const open = await openRows();
  const archived = await archivedRows();
  check('it left the Applications list immediately', !open.some((r) => r.jobLeadId === leadId));
  check('…and appears in the Archive', archived.some((r) => r.jobLeadId === leadId));

  // The gap this session closed: a real dropped email's own date/sender must
  // land on the row, not "today, no address" (the pre-existing §2.0 default).
  const leadId2 = await makeLead('Declined, real email');
  await applicationSent(OWNER, leadId2, {});
  const dropped = await storeEmailArtifact(
    OWNER,
    leadId2,
    'decline',
    droppedEml('Absage.eml', 'Mon, 03 Aug 2026 09:15:00 +0200', '"Hoerbiger HR" <system@successfactors.eu>')
  );
  check('storeEmailArtifact reads the date out of the file', dropped.emailDate?.toISOString() === new Date('2026-08-03T07:15:00Z').toISOString());
  check('storeEmailArtifact reads the sender out of the file', dropped.senderEmail === 'system@successfactors.eu');
  await decline(OWNER, leadId2, {
    outcomeEmailLink: dropped.link,
    outcomeAt: dropped.emailDate ?? undefined,
    contactEmail: dropped.senderEmail,
  });
  const row2 = await appRow(leadId2);
  check(
    "Process Closed is the email's own date, not the drop date",
    row2?.outcomeAt?.toISOString() === new Date('2026-08-03T07:15:00Z').toISOString()
  );
  check('the Email address column is populated from the drop', row2?.contactEmail === 'system@successfactors.eu');
}

/** §2.4 — interview drop, then the manually typed interview date. */
async function checkInterview(): Promise<void> {
  console.log('\n§2.4 · dropping an interview invite');
  const leadId = await makeLead('Interviewing');
  await applicationSent(OWNER, leadId, {});
  const { link } = await storeEmailArtifact(OWNER, leadId, 'interview', droppedMsg('Einladung.msg'));
  const at = new Date('2026-07-24T11:30:00Z');
  await interviewScheduled(OWNER, leadId, { outcomeEmailLink: link, outcomeAt: at });

  let row = await appRow(leadId);
  check('status is interview', row?.status === 'interview', String(row?.status));
  check('outcomeEmailLink points at the archived invite', row?.outcomeEmailLink === link);
  check('outcomeAt records the setup date', row?.outcomeAt?.toISOString() === at.toISOString());
  check('interviewAt is still empty — no email carries a future fact', row?.interviewAt === null);

  const when = new Date('2026-08-04T13:00:00Z');
  await setInterviewAt(OWNER, leadId, when);
  row = await appRow(leadId);
  check('the picker persists a manually entered interview date', row?.interviewAt?.toISOString() === when.toISOString());

  check('it stays in the Applications list', (await openRows()).some((r) => r.jobLeadId === leadId));
  check('…and not in the Archive', !(await archivedRows()).some((r) => r.jobLeadId === leadId));

  // A decline after an interview is still the terminal move.
  await decline(OWNER, leadId, {});
  check('a post-interview decline still lands in the Archive', (await archivedRows()).some((r) => r.jobLeadId === leadId));
}

/**
 * §2.4 — the Archive holds stopped *applications*, not everything terminal.
 * Part 1's triage drops never had an application, so they must not appear, and
 * their data must be left completely alone for the future stats CI.
 */
async function checkArchiveScope(): Promise<void> {
  console.log('\n§2.4 · what the Archive does and does not contain');
  const roadblocked = await makeLead('Roadblocked lead');
  const misaligned = await makeLead('Misaligned lead');
  await db.update(jobLeads).set({ status: 'roadblocked' }).where(eq(jobLeads.id, roadblocked));
  await db.update(jobLeads).set({ status: 'misaligned' }).where(eq(jobLeads.id, misaligned));

  const archived = await archivedRows();
  check('no roadblocked lead appears in the Archive', !archived.some((r) => r.jobLeadId === roadblocked));
  check('no misaligned lead appears in the Archive', !archived.some((r) => r.jobLeadId === misaligned));
  check(
    'every Archive row is screened_out and nothing else',
    archived.every((r) => r.status === ARCHIVED_APPLICATION_STATUS),
    `${archived.length} row(s)`
  );

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobLeads)
    .where(and(eq(jobLeads.ownerId, OWNER), inArray(jobLeads.status, ['roadblocked', 'misaligned'])));
  check('the throughput data the future stats CI needs is untouched', n === 2, `${n} lead(s) still on record`);
}

/** The predicates the two routes actually query with. */
async function openRows() {
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.ownerId, OWNER), inArray(applications.status, [...OPEN_APPLICATION_STATUSES])));
}
async function archivedRows() {
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.ownerId, OWNER), eq(applications.status, ARCHIVED_APPLICATION_STATUS)));
}

async function main(): Promise<void> {
  console.log('Verifying CI · Scoring Phase Redesign — Part 2');
  try {
    await checkStoragePrefix();
    await checkLabelsAndStale();
    checkEmailParsing();
    await checkApplicationSent();
    await checkDecline();
    await checkInterview();
    await checkArchiveScope();
  } finally {
    await cleanup();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  await cleanup().catch(() => {});
  console.error(err);
  process.exit(1);
});
