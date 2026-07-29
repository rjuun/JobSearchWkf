/**
 * One-row correction found by auditing all 91 Archive (screened_out) rows'
 * outcome_at against "Reconciliation Files/Final Reconciliation Review.xlsx"
 * (Sharepoint - Job Leads Table, Comment/Action-driven source-of-truth,
 * 2026-07-29). 90/91 matched exactly. This one didn't:
 *
 * seq 184 — "Chief of Staff" / Erste Digital, Vienna (leadId below). Its
 * Comment is category (b), "Exists in App-Job-Leads and in Sharepoint-Job-
 * Leads" — per Reggie's own rule, Process Closed must come from the
 * Sharepoint Job Leads table's own column, never the Applications table
 * (that fallback is category (c) only). Round 1's reconciliation nonetheless
 * linked this row to Applications-table Folder ID 438 — which actually
 * belongs to an unrelated posting, "Chief of Staff - Avilon" — and copied
 * *that* row's dates (applied 2026-02-19, closed 2026-02-23) into this
 * lead's outcome_notes, which is what the earlier outcome_at backfill then
 * faithfully (and wrongly) parsed.
 *
 * Correct values, from Sharepoint - Job Leads Table's own columns for seq 184:
 *   Application Date -> 2026-07-14
 *   Process Closed    -> 2026-07-20
 *
 * Usage:
 *   npx tsx scripts/fix-erste-digital-dates.ts            # dry run
 *   npx tsx scripts/fix-erste-digital-dates.ts --apply    # commit
 */
import './_env';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, applications } from '../lib/db/schema';

const LEAD_ID = 'a112b33a-1b3a-4da1-b099-522b97da7b90'; // seq 184, Chief of Staff / Erste Digital
const CORRECT_APPLIED_AT = new Date('2026-07-14T00:00:00.000Z');
const CORRECT_OUTCOME_AT = new Date('2026-07-20T00:00:00.000Z');
const CORRECTED_NOTES =
  'SharePoint reconciliation import — corrected 2026-07-29: round 1 mistakenly ' +
  'linked this row to Applications folder ID 438 ("Chief of Staff - Avilon", an ' +
  'unrelated posting). Dates below are from Sharepoint - Job Leads Table\'s own ' +
  'Application Date / Process Closed columns for this lead directly.\n' +
  'Progress: 9 - Stopped\nProcess Closed: 2026-07-20T00:00:00.000Z';

async function main() {
  const apply = process.argv.includes('--apply');

  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobLeadId, LEAD_ID), eq(applications.ownerId, DEMO_OWNER_ID)));

  if (!row) {
    console.log('No applications row found for this leadId — nothing to fix.');
    process.exit(0);
  }

  console.log('Current:', { appliedAt: row.appliedAt, outcomeAt: row.outcomeAt, status: row.status });
  console.log('Will become:', { appliedAt: CORRECT_APPLIED_AT, outcomeAt: CORRECT_OUTCOME_AT });

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  await db
    .update(applications)
    .set({ appliedAt: CORRECT_APPLIED_AT, outcomeAt: CORRECT_OUTCOME_AT, outcomeNotes: CORRECTED_NOTES, updatedAt: new Date() })
    .where(and(eq(applications.jobLeadId, LEAD_ID), eq(applications.ownerId, DEMO_OWNER_ID)));

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
