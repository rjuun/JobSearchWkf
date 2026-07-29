/**
 * Reverts the 17 leads that got auto-relabeled "3 - Waiting Application
 * Reply" -> response_pending by fix-reconciliation-status-labels.ts, once
 * Reggie flagged (2026-07-29) that the Applications tab should hold only the
 * 5 leads he personally verified — everything else round 1's snapshot
 * claimed was "waiting" is unverified: all 17 were sitting at
 * job_leads.status = 'captured' before any of this reconciliation touched
 * them (never screened in the app), with applied dates from round 1's data
 * spanning Nov 2025 - May 2026 — too old to trust as still "pending" without
 * a real check. One (seq 80, GSK) even carries a contradictory proposedStatus
 * of 'archived' alongside a "waiting" application status within round 1's
 * own data.
 *
 * This undoes exactly what the reconciliation apply did to these 17: deletes
 * the applications row, restores job_leads.status to 'captured' (recorded as
 * each row's pre-reconciliation currentStatus in
 * scripts/data/sharepoint-reconciliation.json). They're ordinary captured
 * leads again, pending Reggie bringing verified current status in a future
 * round — same as his original plan.
 *
 * Usage:
 *   npx tsx scripts/revert-unverified-applications.ts            # dry run
 *   npx tsx scripts/revert-unverified-applications.ts --apply    # commit
 */
import './_env';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, applications, jobLeads } from '../lib/db/schema';

const SEQS = [36, 75, 45, 80, 69, 51, 82, 66, 64, 1, 110, 109, 74, 111, 112, 113, 114];

async function main() {
  const apply = process.argv.includes('--apply');

  const leads = await db
    .select({ id: jobLeads.id, seq: jobLeads.seq, title: jobLeads.title, company: jobLeads.company, status: jobLeads.status })
    .from(jobLeads)
    .where(eq(jobLeads.ownerId, DEMO_OWNER_ID));
  const bySeq = new Map(leads.map((l) => [l.seq, l]));

  console.log(`Reverting ${SEQS.length} leads:\n`);
  for (const seq of SEQS) {
    const lead = bySeq.get(seq);
    if (!lead) {
      console.log(`seq ${seq}: NOT FOUND — skipping`);
      continue;
    }
    const [app] = await db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.jobLeadId, lead.id), eq(applications.ownerId, DEMO_OWNER_ID)));
    console.log(
      `seq ${seq} | ${lead.title?.slice(0, 40).padEnd(40)} | ${lead.company ?? '—'} | ` +
        `status "${lead.status}" -> "captured"; applications row ${app ? `(status "${app.status}") will be DELETED` : '(none — nothing to delete)'}`
    );
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying (single transaction — all or nothing)...');
  await db.transaction(async (tx) => {
    for (const seq of SEQS) {
      const lead = bySeq.get(seq);
      if (!lead) continue;
      await tx.delete(applications).where(and(eq(applications.jobLeadId, lead.id), eq(applications.ownerId, DEMO_OWNER_ID)));
      await tx
        .update(jobLeads)
        .set({ status: 'captured', updatedAt: new Date() })
        .where(and(eq(jobLeads.id, lead.id), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
    }
  });
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
