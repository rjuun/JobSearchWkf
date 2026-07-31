/**
 * Third follow-up to scripts/restore-job-leads.ts — 2026-07-30.
 *
 * The wipe that deleted job_leads (see restore-job-leads.ts's header) also deleted every row
 * in `applications` — and nothing since has restored it. Separately, an earlier
 * `scripts/reconcile-sharepoint.ts` run (before the wipe) had written raw SharePoint process-
 * status strings straight into `applications.status` (e.g. "9 - Stopped") instead of mapping
 * them to the app's real vocabulary (`lib/applications.ts` — `screened_out`, `response_pending`,
 * `interview`, etc.), so even a straight restore of the old table would have carried the bug
 * forward. This script writes the applications table fresh, with correct statuses, instead of
 * trying to un-break the old rows.
 *
 * Source data: Reconciliation Files/applications-reconcile.json — 96 entries built from
 * Reconciliation Files/reconciliation_final.json (91 rows, SharePoint "9 - Stopped", full
 * appliedAt/outcomeNotes carried over) plus 5 rows Reggie confirmed by hand as still live/
 * waiting for a reply (BBVA, SimCorp, BJAK, Johnson & Johnson, ENPULSION — dated from the raw
 * SharePoint "Sharepoint - Applications Table" export, 2026-06-23 through 2026-07-20).
 *
 * Reggie's own three-way split (2026-07-30): 91 → Archive, 5 → Applications (open), everything
 * else → Results — meaning no application row at all for the other ~60 leads. The other ~14
 * SharePoint rows that also carried a "waiting reply"/"send application" label are deliberately
 * NOT included here: per Reggie, only the 5 named leads are still genuinely live; the rest are
 * stale (some date back to 2025-11) and get no application record, leaving them to whatever
 * pipeline status they already have (jobLeads.status), same as any other un-applied lead.
 *
 * Mirrors app/actions/monitoring.ts's markAppliedAction: an application row and jobLeads.status
 * are always written together, so the Flow tab counts (lib/queries.ts flowCounts()) and the
 * Applications/Archive lists (listOpenApplications/listArchivedApplications) agree with each
 * other immediately, with no derived/inconsistent state.
 *
 * Safety: deletes any existing applications row for each of these 96 (owner, leadId) pairs
 * before inserting — harmless if the table is already empty (the expected case), and correct
 * if a later `reconcile-sharepoint.ts` re-run already re-seeded the old wrong strings.
 *
 * Run: `npx tsx scripts/reconcile-applications.ts` (add `--dry-run` to preview without writing).
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { applications, jobLeads } from '../lib/db/schema';

const ROOT = process.cwd();
const RECONCILE_JSON = path.join(ROOT, 'Reconciliation Files', 'applications-reconcile.json');
const DRY_RUN = process.argv.includes('--dry-run');

type Entry = {
  leadId: string;
  seq: number | null;
  title: string;
  company: string | null;
  appStatus: 'screened_out' | 'response_pending';
  leadStatus: 'archived' | 'applied';
  appliedAt: string;
  outcomeNotes: string | null;
};

async function main() {
  console.log(`▶ Reading ${RECONCILE_JSON}`);
  const entries = JSON.parse(fs.readFileSync(RECONCILE_JSON, 'utf8')) as Entry[];
  console.log(`  ${entries.length} entries (${entries.filter((e) => e.appStatus === 'screened_out').length} archive, ${entries.filter((e) => e.appStatus === 'response_pending').length} open applications)`);

  if (DRY_RUN) {
    console.log('— DRY RUN — would write:');
    for (const e of entries) {
      console.log(`  seq ${e.seq}  ${e.appStatus.padEnd(16)}  lead.status=${e.leadStatus.padEnd(9)}  ${e.title} — ${e.company}`);
    }
    console.log(`Total: ${entries.length} applications rows + matching jobLeads.status updates.`);
    console.log('Everything else (~60 leads) is left untouched — no application row, current lead status stands (Results).');
    return;
  }

  // Owner is the same for every row here (single-tenant demo) — read it off the first lead.
  const owner = (await db.select({ ownerId: jobLeads.ownerId }).from(jobLeads).where(eq(jobLeads.id, entries[0].leadId)))[0]?.ownerId;
  if (!owner) throw new Error(`Could not resolve ownerId from lead ${entries[0].leadId} — is job_leads restored?`);

  let written = 0;
  for (const e of entries) {
    await db.delete(applications).where(and(eq(applications.ownerId, owner), eq(applications.jobLeadId, e.leadId)));
    await db.insert(applications).values({
      ownerId: owner,
      jobLeadId: e.leadId,
      appliedAt: new Date(e.appliedAt),
      status: e.appStatus,
      outcomeNotes: e.outcomeNotes,
    });
    await db.update(jobLeads).set({ status: e.leadStatus }).where(and(eq(jobLeads.id, e.leadId), eq(jobLeads.ownerId, owner)));
    written += 1;
  }
  console.log(`✓ Wrote ${written} applications rows (91 screened_out / 5 response_pending) and matching jobLeads.status.`);
  console.log('  Everything else keeps its existing lead status — no application record created for those.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
