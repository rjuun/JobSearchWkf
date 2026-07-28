/**
 * SharePoint reconciliation — backfills job_leads.status (and a few core
 * capture fields) and upserts applications rows from the user's manually
 * cross-referenced workbook ("Final Reconciliation Review.xlsx"):
 *
 *   App - Job Leads Table  <-- seq/external_id -->  Sharepoint - Job Leads Table
 *   Sharepoint - Job Leads Table  <-- Folder ID -->  Sharepoint - Applications Table
 *
 * Source data: scripts/data/sharepoint-reconciliation.json (157 rows, one per
 * SharePoint Job Leads list item), pre-joined and status-mapped in the
 * reconciliation session — see that file for the exact fields per row.
 *
 * Status mapping (confirmed with the owner):
 *   - SharePoint Process Status / Progress containing "9 - Stopped",
 *     "Discarded", or "Not Proceeding"  -> job_leads.status = 'archived'
 *     (process closed / lead discarded during screening / dropped for score,
 *     age, or competition — all dead ends, regardless of current App status).
 *   - Otherwise, any row with a matched SharePoint Applications folder
 *     -> job_leads.status = 'applied'.
 *   - No application and no stopped/discarded signal -> status left untouched.
 *
 * Only fills company/city/source_url/job_post_link when the App's current
 * value is blank — never overwrites existing data. Status is the one field
 * this script actively corrects, since that was the point of the exercise.
 *
 * Application rows are upserted on the (owner_id, job_lead_id) unique index,
 * same pattern as app/actions/monitoring.ts:markAppliedAction. HR contact /
 * interviewer / stopped reason / process-closed date are folded into
 * outcome_notes as labeled text (no dedicated columns exist for them yet).
 * Email Response / Email Address were intentionally left out of this pass.
 *
 * Usage:
 *   npx tsx scripts/reconcile-sharepoint.ts            # dry run — prints the plan, writes nothing
 *   npx tsx scripts/reconcile-sharepoint.ts --apply     # actually writes
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, jobLeads, applications } from '../lib/db/schema';

type Row = {
  seq: number;
  action: 'new_lead' | 'update';
  leadId: string | null;
  title: string | null;
  company: string | null;
  city: string | null;
  sourceUrl: string | null;
  jobPostLink: string | null;
  proposedStatus: string | null;
  currentStatus: string | null;
  currentCompany: string | null;
  currentCity: string | null;
  currentSourceUrl: string | null;
  currentJobPostLink: string | null;
  application: { appliedAt: string | null; status: string | null; outcomeNotes: string } | null;
};

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '' || v === '[NULL]';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dataPath = path.join(__dirname, 'data', 'sharepoint-reconciliation.json');
  const rows: Row[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const plan = {
    newLeads: rows.filter((r) => r.action === 'new_lead'),
    statusChanges: rows.filter((r) => r.action === 'update' && r.proposedStatus && r.proposedStatus !== r.currentStatus),
    fieldFills: rows.filter(
      (r) =>
        r.action === 'update' &&
        ((blank(r.currentCompany) && !blank(r.company)) ||
          (blank(r.currentCity) && !blank(r.city)) ||
          (blank(r.currentSourceUrl) && !blank(r.sourceUrl)) ||
          (blank(r.currentJobPostLink) && !blank(r.jobPostLink)))
    ),
    applicationUpserts: rows.filter((r) => r.application),
  };

  console.log(`Plan: ${plan.newLeads.length} new leads, ${plan.statusChanges.length} status changes, ` +
    `${plan.fieldFills.length} field backfills, ${plan.applicationUpserts.length} application upserts.`);
  console.log();
  console.log('Status transitions:');
  const transitions = new Map<string, number>();
  for (const r of plan.statusChanges) {
    const key = `${r.currentStatus ?? '(none)'} -> ${r.proposedStatus}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
  }
  for (const [k, v] of transitions) console.log(`  ${k}: ${v}`);
  console.log();
  console.log('New leads to create:');
  for (const r of plan.newLeads) console.log(`  seq ${r.seq}: ${r.title} — ${r.company} (${r.city ?? 'no city'})`);

  if (!apply) {
    console.log();
    console.log('Dry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log();
  console.log('Applying (single transaction — all or nothing)...');

  let created = 0, statusUpdated = 0, fieldsBackfilled = 0, appsUpserted = 0;

  await db.transaction(async (tx) => {
    for (const r of rows) {
      let leadId = r.leadId;

      if (r.action === 'new_lead') {
        const existing = await tx.select({ id: jobLeads.id }).from(jobLeads).where(eq(jobLeads.seq, r.seq)).limit(1);
        if (existing.length) {
          leadId = existing[0].id;
        } else {
          const [inserted] = await tx
            .insert(jobLeads)
            .values({
              ownerId: DEMO_OWNER_ID,
              externalId: String(r.seq),
              seq: r.seq,
              title: r.title ?? 'Untitled role',
              company: r.company,
              city: r.city,
              sourceUrl: r.sourceUrl,
              jobPostLink: r.jobPostLink,
              status: (r.proposedStatus as any) ?? 'captured',
              source: 'SharePoint reconciliation import',
            })
            .returning({ id: jobLeads.id });
          leadId = inserted.id;
          created++;
        }
      } else if (leadId) {
        const setFields: Record<string, unknown> = {};
        if (blank(r.currentCompany) && !blank(r.company)) setFields.company = r.company;
        if (blank(r.currentCity) && !blank(r.city)) setFields.city = r.city;
        if (blank(r.currentSourceUrl) && !blank(r.sourceUrl)) setFields.sourceUrl = r.sourceUrl;
        if (blank(r.currentJobPostLink) && !blank(r.jobPostLink)) setFields.jobPostLink = r.jobPostLink;
        if (Object.keys(setFields).length) fieldsBackfilled++;
        if (r.proposedStatus && r.proposedStatus !== r.currentStatus) {
          setFields.status = r.proposedStatus;
          statusUpdated++;
        }
        if (Object.keys(setFields).length) {
          await tx.update(jobLeads).set(setFields as any).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
        }
      }

      if (r.application && leadId) {
        // Pass the applied-at as an ISO string with an explicit cast rather than a
        // JS Date — postgres.js can't serialize a bare Date interpolated into a raw
        // sql`` fragment (only via drizzle's typed .values()/.set() path), and throws
        // ERR_INVALID_ARG_TYPE deep in its parameter binder if you try.
        const appliedAtIso = r.application.appliedAt; // e.g. "2026-02-19T10:31:00.000Z" | null
        await tx
          .insert(applications)
          .values({
            ownerId: DEMO_OWNER_ID,
            jobLeadId: leadId,
            appliedAt: appliedAtIso ? new Date(appliedAtIso) : null,
            status: r.application.status,
            outcomeNotes: r.application.outcomeNotes,
          })
          .onConflictDoUpdate({
            target: [applications.ownerId, applications.jobLeadId],
            set: {
              appliedAt: appliedAtIso
                ? sql`coalesce(${applications.appliedAt}, ${appliedAtIso}::timestamptz)`
                : applications.appliedAt,
              status: r.application.status,
              outcomeNotes: r.application.outcomeNotes,
            },
          });
        appsUpserted++;
      }
    }
  });

  console.log(`Done. Created ${created} leads, updated status on ${statusUpdated}, backfilled fields on ${fieldsBackfilled}, upserted ${appsUpserted} applications.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
