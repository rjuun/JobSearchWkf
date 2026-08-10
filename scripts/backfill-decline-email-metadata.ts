/**
 * Corrects rows written before lib/email-parse.ts existed (2026-08-10 evening
 * session — the "Archive reconciliation" pass Reggie did by hand, dropping
 * decline emails onto the live Applications list). At that point the drop
 * path had no date/sender extraction (CI · Scoring Phase Redesign Part 2,
 * §2.0 explicitly deferred it), so every one of those rows got today's date
 * as `outcomeAt` ("Process Closed") and a null `contact_email` — not the
 * decline email's own date and sender.
 *
 * The dropped files are still sitting in storage (this app's own drop target
 * stores the file itself, per the CI's confirmed 2026-07-28 decision — see
 * that CI's log). This re-reads each one and corrects the row from the file's
 * own content, no re-dropping required.
 *
 * Scope: every `applications` row whose `outcome_email_link` points at this
 * app's own `/api/applications/{leadId}/email/{file}` route (i.e. a real
 * stored file, not a SharePoint-reconciliation deep link or an ATS dashboard
 * URL — those have no file to re-parse and are left untouched). Safe to
 * re-run: a row already correct just gets rewritten to the same values.
 *
 * Usage:
 *   npx tsx scripts/backfill-decline-email-metadata.ts            # dry run
 *   npx tsx scripts/backfill-decline-email-metadata.ts --apply    # commit
 */
import './_env';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { applications, jobLeads } from '../lib/db/schema';
import { emailArtifactPath, isSafeObjectName } from '../lib/applications';
import { exists, readBuffer } from '../lib/storage';
import { parseEmailArtifact } from '../lib/email-parse';

async function main() {
  const apply = process.argv.includes('--apply');

  const rows = await db
    .select({
      id: applications.id,
      jobLeadId: applications.jobLeadId,
      status: applications.status,
      outcomeEmailLink: applications.outcomeEmailLink,
      outcomeAt: applications.outcomeAt,
      contactEmail: applications.contactEmail,
      title: jobLeads.title,
      company: jobLeads.company,
      seq: jobLeads.seq,
    })
    .from(applications)
    .innerJoin(jobLeads, eq(jobLeads.id, applications.jobLeadId))
    .where(isNotNull(applications.outcomeEmailLink))
    .then((r) => r.filter((row) => row.outcomeEmailLink?.startsWith('/api/applications/')));

  console.log(`${rows.length} row(s) with a stored (non-reconciliation) outcome email link.\n`);

  let corrected = 0;
  for (const row of rows) {
    const link = row.outcomeEmailLink!;
    const file = decodeURIComponent(link.slice(link.lastIndexOf('/') + 1));
    if (!isSafeObjectName(file)) {
      console.log(`seq ${row.seq} | ${row.title.slice(0, 30).padEnd(30)} — unsafe object name in link, skipping`);
      continue;
    }
    const rel = emailArtifactPath(row.jobLeadId, file);
    if (!(await exists(rel))) {
      console.log(`seq ${row.seq} | ${row.title.slice(0, 30).padEnd(30)} — stored file missing, skipping`);
      continue;
    }
    const buf = await readBuffer(rel);
    const { date, senderEmail } = parseEmailArtifact(buf, file);
    if (!date && !senderEmail) {
      console.log(`seq ${row.seq} | ${row.title.slice(0, 30).padEnd(30)} — file didn't parse (nothing to correct)`);
      continue;
    }

    const dateChanged = date && date.toISOString() !== row.outcomeAt?.toISOString();
    const emailChanged = senderEmail && senderEmail !== row.contactEmail;
    if (!dateChanged && !emailChanged) {
      console.log(`seq ${row.seq} | ${row.title.slice(0, 30).padEnd(30)} — already correct`);
      continue;
    }

    corrected++;
    console.log(
      `seq ${row.seq} | ${(row.company ?? row.title).slice(0, 30).padEnd(30)} | ` +
        `Process Closed: ${row.outcomeAt?.toISOString().slice(0, 10) ?? '(none)'} -> ${date?.toISOString().slice(0, 10) ?? '(unchanged)'} | ` +
        `Email address: ${row.contactEmail ?? '(null)'} -> ${senderEmail ?? '(unchanged)'}`
    );

    if (apply) {
      await db
        .update(applications)
        .set({
          ...(date ? { outcomeAt: date } : {}),
          ...(senderEmail ? { contactEmail: senderEmail } : {}),
          updatedAt: new Date(),
        })
        .where(eq(applications.id, row.id));
    }
  }

  console.log(`\n${corrected} row(s) ${apply ? 'corrected' : 'would be corrected'}.`);
  if (!apply) console.log('Dry run only — no changes written. Re-run with --apply to commit.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
