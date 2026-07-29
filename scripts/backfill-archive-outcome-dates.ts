/**
 * Backfills applications.outcome_at for the 91 reconciled "Stopped" rows
 * (see fix-reconciliation-status-labels.ts, already applied).
 *
 * That fix remapped status "9 - Stopped" -> screened_out but never touched
 * outcome_at — the real close date was only ever text inside outcome_notes
 * ("...\nProcess Closed: 2026-02-23T00:00:00"), which is why the Archive
 * list (components/roleproof/archive-list.tsx) renders "Stopped —" with a
 * blank date for every reconciled row: fmtDate(row.outcomeAt) has nothing
 * to format. All 91 rows have a parseable date in that exact format
 * (verified against scripts/data/sharepoint-reconciliation.json).
 *
 * Usage:
 *   npx tsx scripts/backfill-archive-outcome-dates.ts            # dry run
 *   npx tsx scripts/backfill-archive-outcome-dates.ts --apply    # commit
 */
import './_env';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, applications } from '../lib/db/schema';

function parseProcessClosed(notes: string | null): Date | null {
  if (!notes) return null;
  const m = notes.match(/Process Closed:\s*(\S+)/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const rows = await db
    .select({ id: applications.id, jobLeadId: applications.jobLeadId, outcomeNotes: applications.outcomeNotes })
    .from(applications)
    .where(and(eq(applications.status, 'screened_out'), eq(applications.ownerId, DEMO_OWNER_ID), isNull(applications.outcomeAt)));

  const parsed = rows.map((r) => ({ ...r, closedAt: parseProcessClosed(r.outcomeNotes) }));
  const good = parsed.filter((r) => r.closedAt);
  const unparseable = parsed.filter((r) => !r.closedAt);

  console.log(`screened_out rows with outcomeAt still null: ${rows.length}`);
  console.log(`  parseable "Process Closed" date found: ${good.length}`);
  console.log(`  no parseable date (left untouched): ${unparseable.length}`);
  for (const r of unparseable) console.log(`    lead ${r.jobLeadId}: outcomeNotes = ${JSON.stringify(r.outcomeNotes)}`);

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying...');
  await db.transaction(async (tx) => {
    for (const r of good) {
      await tx.update(applications).set({ outcomeAt: r.closedAt!, updatedAt: new Date() }).where(eq(applications.id, r.id));
    }
  });
  console.log(`Done. Backfilled outcomeAt on ${good.length} rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
