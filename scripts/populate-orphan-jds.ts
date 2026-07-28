/**
 * Final 5 leads from the "48 with blank jd_text" set that backfill-jd-text-v2.ts
 * couldn't recover from local storage: seq 27 (Chief of Staff / Aviloo),
 * 30 (Chief of Staff / i5Invest), 34 (Chief of Staff / Andercore),
 * 52 (Strategy Manager / Agrana), 90 (Head of FP&A / Finatal).
 *
 * None of these had a folder_id in the SharePoint Job Leads list (i.e. never
 * officially linked to an Applications-library folder) — but the exact
 * matching folder for each exists in the same SharePoint Applications export
 * used for the earlier reconciliation, just orphaned (unlinked). Confirmed by
 * title/company match and by reading the extracted text directly:
 *   - seq 52 "Agrana" is the parent company of "Austria Juice" — the posting
 *     itself is branded Austria Juice, which is exactly the file that seq 124
 *     ("Strategy Manager / UNIQA") was wrongly linked to during the earlier
 *     reconciliation. That mismatch is now explained: the Applications folder
 *     for THIS lead (seq 52) somehow got Folder-ID-linked to a different Job
 *     Leads row (seq 124) instead of its own.
 *   - seq 27/30/34 all confirmed via OCR content matching Aviloo / i5invest /
 *     Andercore respectively.
 *
 * Source: scripts/data/orphan-jd-data.json.
 *
 * Usage:
 *   npx tsx scripts/populate-orphan-jds.ts            # dry run
 *   npx tsx scripts/populate-orphan-jds.ts --apply     # write
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, jobLeads } from '../lib/db/schema';

type Row = { seq: number; title: string; company: string; jdText: string };

async function main() {
  const apply = process.argv.includes('--apply');
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'orphan-jd-data.json'), 'utf8'));

  let written = 0;
  for (const r of rows) {
    const [lead] = await db
      .select({ id: jobLeads.id, title: jobLeads.title, company: jobLeads.company, jdText: jobLeads.jdText })
      .from(jobLeads)
      .where(and(eq(jobLeads.seq, r.seq), eq(jobLeads.ownerId, DEMO_OWNER_ID)))
      .limit(1);

    if (!lead) {
      console.log(`seq ${r.seq}: NOT FOUND in DB — skipping`);
      continue;
    }
    const blank = !lead.jdText || lead.jdText.trim() === '';
    console.log(`seq ${r.seq} (${lead.title} — ${lead.company}): ${blank ? `will write ${r.jdText.length} chars` : 'already has jd_text, skipping'}`);
    if (!blank || !apply) continue;

    await db.update(jobLeads).set({ jdText: r.jdText }).where(and(eq(jobLeads.id, lead.id), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
    written++;
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
  } else {
    console.log(`\nDone. Wrote jd_text on ${written} leads.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
