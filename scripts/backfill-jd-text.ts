/**
 * Follow-up to scripts/restore-job-leads.ts — 2026-07-30.
 *
 * The "App - Job Leads Table" reconciliation snapshot only ever had `jd_text` populated for
 * 1 of 156 rows (verified directly against the source file, not a restore-script bug). The
 * earlier reconciliation work in this same project produced a purpose-built fix for that:
 * `Reconciliation Files/jd-populate-data.json` — 109 entries, each carrying the real
 * `leadId` (matched 100% against the restored job_leads, zero orphans), an
 * `extractionStatus` (`ok` / `ok-via-ocr` / `ok-fixed` — all succeeded), and the actual
 * extracted `jdText`.
 *
 * This backfills those 109 leads by id. It does NOT touch the other 46 leads that have no
 * jd_text anywhere in Reconciliation Files/ — those need a fresh decision (re-capture? a
 * source Reggie has elsewhere?), listed at the end of a dry run.
 *
 * Run: `npx tsx scripts/backfill-jd-text.ts` (add `--dry-run` to preview without writing).
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';

const ROOT = process.cwd();
const POPULATE_JSON = path.join(ROOT, 'Reconciliation Files', 'jd-populate-data.json');
const DRY_RUN = process.argv.includes('--dry-run');

type PopulateEntry = {
  seq: number;
  leadId: string;
  title: string;
  company: string;
  sourceFile: string;
  extractionStatus: string;
  jdText: string;
  currentJdBlank: boolean;
};

async function main() {
  console.log(`▶ Reading ${POPULATE_JSON}`);
  const entries = JSON.parse(fs.readFileSync(POPULATE_JSON, 'utf8')) as PopulateEntry[];
  console.log(`  ${entries.length} backfill entries`);

  const withText = entries.filter((e) => e.jdText && e.jdText.trim());
  if (withText.length !== entries.length) {
    console.log(`  ! ${entries.length - withText.length} entries have no jdText — skipping those`);
  }

  if (DRY_RUN) {
    console.log('— DRY RUN — would update jd_text for these leads:');
    for (const e of withText) console.log(`  ${e.leadId}  (${e.extractionStatus})  ${e.title} — ${e.company}`);
    console.log(`Total: ${withText.length} leads would be updated.`);
    return;
  }

  let updated = 0;
  for (const e of withText) {
    const res = await db.update(jobLeads).set({ jdText: e.jdText }).where(eq(jobLeads.id, e.leadId));
    updated += (res as unknown as { rowCount?: number }).rowCount ?? 1;
  }
  console.log(`✓ Backfilled jd_text for ${updated} leads.`);
  console.log('  46 leads still have no jd_text anywhere in Reconciliation Files/ — see chat for the list.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
