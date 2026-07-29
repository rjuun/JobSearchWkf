/**
 * Reconciliation round 3 (2026-07-29) — Email address / Email response for
 * the Archive, per Reggie's request. Sourced from "Reconciliation Files/Final
 * Reconciliation Review.xlsx" using the same Comment/Action priority as the
 * date audit: category (a)/(b) rows read Sharepoint - Job Leads Table's own
 * Email Address / Email Response columns directly; category (c) rows check
 * those first and fall back to the linked Sharepoint - Applications Table row
 * (by Folder ID) only if blank.
 *
 * "Email Response" in the source is a SharePoint hyperlink column whose
 * display text is almost always the unhelpful literal "Open Email" — the
 * real value is the link target (an Outlook web deep-link, or occasionally an
 * ATS dashboard URL), extracted via openpyxl's hyperlink.target rather than
 * the cell's display value. That target is stored in the existing
 * applications.outcome_email_link column (§2.2.C already means "a link
 * explaining the outcome" — this is exactly that, just for a historical,
 * backfilled case instead of a live in-app drop). Email Address is genuinely
 * new information — lives in the new applications.contact_email column
 * (added alongside this script; run `drizzle-kit generate` + migrate first).
 *
 * scripts/data/archive-email-backfill.json holds the 30 archived leads (of
 * 91) that have at least one of the two fields in the source data — the
 * other 61 simply never had either recorded in SharePoint.
 *
 * Usage:
 *   npx tsx scripts/backfill-archive-emails.ts            # dry run
 *   npx tsx scripts/backfill-archive-emails.ts --apply    # commit
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, applications } from '../lib/db/schema';

type Row = { seq: number; leadId: string; title: string; company: string | null; contactEmail: string | null; emailResponseLink: string | null };

async function main() {
  const apply = process.argv.includes('--apply');
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'archive-email-backfill.json'), 'utf8'));

  console.log(`${rows.length} leads to update:\n`);
  let willUpdate = 0;
  for (const r of rows) {
    const [existing] = await db
      .select({ id: applications.id, contactEmail: applications.contactEmail, outcomeEmailLink: applications.outcomeEmailLink })
      .from(applications)
      .where(and(eq(applications.jobLeadId, r.leadId), eq(applications.ownerId, DEMO_OWNER_ID)));
    if (!existing) {
      console.log(`seq ${r.seq} | ${r.title.slice(0, 30).padEnd(30)} | ${r.company ?? '—'} — NO applications row found, skipping`);
      continue;
    }
    willUpdate++;
    console.log(
      `seq ${r.seq} | ${r.title.slice(0, 30).padEnd(30)} | ${r.company ?? '—'} | ` +
        `contactEmail: ${existing.contactEmail ?? '(null)'} -> ${r.contactEmail ?? '(unchanged)'} | ` +
        `outcomeEmailLink: ${existing.outcomeEmailLink ? 'already set' : '(null)'} -> ${r.emailResponseLink ? 'set' : '(unchanged)'}`
    );
  }
  console.log(`\n${willUpdate} rows will actually be updated.`);

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying...');
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };
      if (r.contactEmail) setFields.contactEmail = r.contactEmail;
      if (r.emailResponseLink) setFields.outcomeEmailLink = r.emailResponseLink;
      if (Object.keys(setFields).length === 1) continue; // nothing but updatedAt
      await tx
        .update(applications)
        .set(setFields)
        .where(and(eq(applications.jobLeadId, r.leadId), eq(applications.ownerId, DEMO_OWNER_ID)));
    }
  });
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
