/**
 * One-time cleanup after the round-1/round-2 SharePoint reconciliation apply
 * (see Process/CI/Scoring Phase Redesign - Part 2.md progress log, 2026-07-29).
 *
 * scripts/reconcile-sharepoint.ts writes applications.status (and
 * job_leads.status) directly via Drizzle, bypassing the ALLOWED_OUTCOMES
 * guard in app/actions/monitoring.ts (or lib/monitoring.ts post-Part-2).
 * Round 1's data file stored the raw SharePoint Process Status label as
 * application.status instead of mapping it to the app's actual vocabulary,
 * so 110 rows landed wrong, in two different ways:
 *
 * 1. Simple relabel — the application was real, only the stored word is
 *    wrong:
 *      "9 - Stopped"                   -> screened_out    (91 rows)
 *      "3 - Waiting Application Reply" -> response_pending (17 rows)
 *
 * 2. Never actually sent — confirmed with Reggie (2026-07-29): "2 - Send
 *    Application" (2 rows, seq 73 and 107) means leads that were captured
 *    and went stale — never scored (B), never tailored (C), never sent.
 *    The reconciliation apply nonetheless set job_leads.status = 'applied'
 *    and created an applications row with a fabricated appliedAt for both.
 *    Relabeling the status would still leave a lie in the data (an
 *    application row implies something was sent); these two need the
 *    applications row deleted and job_leads.status corrected to 'archived'
 *    — the same terminal bucket stale/dropped leads land in everywhere else
 *    in this app, just for the "never progressed" reason instead of an
 *    active decline.
 *
 * Usage:
 *   npx tsx scripts/fix-reconciliation-status-labels.ts            # dry run
 *   npx tsx scripts/fix-reconciliation-status-labels.ts --apply    # commit
 */
import './_env';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, applications, jobLeads } from '../lib/db/schema';

const LABEL_MAP: Record<string, string> = {
  '9 - Stopped': 'screened_out',
  '3 - Waiting Application Reply': 'response_pending',
};

// Confirmed stale-never-sent leads (§ header comment) — their applications
// row gets deleted, not relabeled, and job_leads.status is corrected.
const STALE_NEVER_SENT: { leadId: string; company: string }[] = [
  { leadId: '96b32ff3-2a07-4bf5-bee5-d6663f5eb0d2', company: 'Autodesk (seq 107)' },
  { leadId: '4c9ffab7-4dd2-46a2-b42f-8252e9e0a195', company: 'Roche / mySugr (seq 73)' },
];

async function main() {
  const apply = process.argv.includes('--apply');

  for (const [from, to] of Object.entries(LABEL_MAP)) {
    const rows = await db.select({ id: applications.id }).from(applications).where(eq(applications.status, from));
    console.log(`"${from}" -> "${to}": ${rows.length} row(s)`);
  }

  console.log();
  for (const { leadId, company } of STALE_NEVER_SENT) {
    const [lead] = await db
      .select({ status: jobLeads.status })
      .from(jobLeads)
      .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
    const [app] = await db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, DEMO_OWNER_ID)));
    console.log(
      `${company}: job_leads.status = "${lead?.status ?? '(not found)'}" -> "archived"; ` +
        `applications row ${app ? `(status "${app.status}") will be DELETED` : '(none found — nothing to delete)'}`
    );
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying (single transaction — all or nothing)...');
  await db.transaction(async (tx) => {
    for (const [from, to] of Object.entries(LABEL_MAP)) {
      await tx.update(applications).set({ status: to, updatedAt: new Date() }).where(eq(applications.status, from));
    }
    for (const { leadId } of STALE_NEVER_SENT) {
      await tx
        .delete(applications)
        .where(and(eq(applications.jobLeadId, leadId), eq(applications.ownerId, DEMO_OWNER_ID)));
      await tx
        .update(jobLeads)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
    }
  });
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
