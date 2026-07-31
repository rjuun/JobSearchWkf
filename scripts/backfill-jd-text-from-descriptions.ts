/**
 * Second follow-up to scripts/restore-job-leads.ts — 2026-07-30.
 *
 * scripts/backfill-jd-text.ts closed 109 of 156 jd_text gaps using
 * Reconciliation Files/jd-populate-data.json. That left 46 leads with no jd_text anywhere in
 * Reconciliation Files/. Of those 46, 41 have a matching file in the OneDrive
 * "JobSearch Camunda/Job Descriptions" folder, keyed by the same `{seq} - ...` filename
 * convention scripts/seed.ts already reads locally (see the `jdDir` block there — this script
 * is the SharePoint-sourced equivalent of that same idea, run once as a backfill rather than
 * every seed).
 *
 * Each of the 41 source files went through the same three problems the seed-time jdDir loader
 * doesn't have to deal with: an Obsidian `simple-time-tracker` fenced code block up top, a
 * YAML-ish frontmatter block (`jd-title:` / `jd-date:` / `jd-time-spent:`) on some files, and in
 * one case (seq 181, BBVA) unrelated Accuracy-Improvement-Tip commentary embedded in the same
 * note above the real JD text. All of that was stripped in a one-off cleaning pass (Cowork
 * sandbox, Python) before being written to
 * Reconciliation Files/jd-populate-data-sharepoint.json — this script just applies it.
 *
 * The remaining 5 leads (Finatal seq 90, Agrana seq 52, Andercore seq 34, i5Invest seq 30,
 * Aviloo seq 27) have no source file anywhere searched. Not handled here — needs a decision from
 * Reggie (re-capture from sourceUrl, or another source).
 *
 * Run: `npx tsx scripts/backfill-jd-text-from-descriptions.ts` (add `--dry-run` to preview).
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';

const ROOT = process.cwd();
const POPULATE_JSON = path.join(ROOT, 'Reconciliation Files', 'jd-populate-data-sharepoint.json');
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
    for (const e of withText) console.log(`  seq ${e.seq}  ${e.leadId}  ${e.title} — ${e.company}`);
    console.log(`Total: ${withText.length} leads would be updated.`);
    console.log('Still unresolved after this run: 5 leads with no source anywhere (Finatal, Agrana, Andercore, i5Invest, Aviloo).');
    return;
  }

  let updated = 0;
  for (const e of withText) {
    await db.update(jobLeads).set({ jdText: e.jdText }).where(eq(jobLeads.id, e.leadId));
    updated += 1;
  }
  console.log(`✓ Backfilled jd_text for ${updated} leads from SharePoint Job Descriptions.`);
  console.log('  5 leads still have no jd_text anywhere (Finatal, Agrana, Andercore, i5Invest, Aviloo) — needs your call.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
