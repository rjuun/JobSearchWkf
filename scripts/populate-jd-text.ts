/**
 * Populates job_leads.jd_text for the ~109 past applications whose Job
 * Description PDF was recovered from the SharePoint "Applications" library
 * export (step 4 of the reconciliation — see reconcile-sharepoint.ts for
 * steps 1-3, the status/application backfill).
 *
 * Source: scripts/data/jd-populate-data.json — one row per SharePoint Job
 * Leads seq, built by:
 *   1. Extracting text from each folder's JD PDF (pdftotext, OCR fallback
 *      for scanned-only PDFs)
 *   2. Cross-checking every extraction against the target company name to
 *      catch cases where the "best" file picked was actually a CV, cover
 *      letter, reference letter, or unrelated posting
 *   3. Excluding 2 leads (seq 124, 184) where the SharePoint folder itself
 *      is linked to the wrong company's posting and no correct JD file
 *      exists in that folder. Turned out both already had the correct JD
 *      sitting in local storage from an earlier LinkedIn-based capture,
 *      entirely independent of SharePoint — see
 *      backfill-jd-text-from-storage.ts, which recovers those two (and any
 *      other lead in the same situation) from the pre-existing blob instead.
 *
 * jd_text is the single source of truth for JD content — runScreening() and
 * the lead workspace page both read it directly. By default this script only
 * writes when the lead's current value is blank (never overwrites) — pass
 * --force to override this for specific --seq values (e.g. after correcting
 * a batch of extractions in the data file that had already been applied once).
 *
 * Usage:
 *   npx tsx scripts/populate-jd-text.ts            # dry run — prints the plan, writes nothing
 *   npx tsx scripts/populate-jd-text.ts --apply     # write to leads whose jd_text is currently blank
 *   npx tsx scripts/populate-jd-text.ts --apply --force --seq 8,12,13   # overwrite specific seqs
 *                                                                        # even if jd_text is already set
 *
 * --force is for re-running after the source data file itself was corrected
 * (e.g. a batch of extractions turned out to be a garbled OCR artifact and
 * were re-extracted from a cleaner source file) — normally the script never
 * overwrites, precisely so it's safe to re-run, but that also means a plain
 * re-run can't fix leads that already got a bad value written on a prior
 * --apply. Combine --force with --seq to limit the blast radius to exactly
 * the leads you know were corrected in the data file.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { DEMO_OWNER_ID, jobLeads } from '../lib/db/schema';

type Row = {
  seq: number;
  leadId: string;
  title: string | null;
  company: string | null;
  sourceFile: string | null;
  extractionStatus: string;
  jdText: string;
  currentJdBlank: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const seqIdx = args.indexOf('--seq');
  const seqFilter = seqIdx !== -1 ? new Set(args[seqIdx + 1].split(',').map((s) => parseInt(s.trim(), 10))) : undefined;
  return { apply, force, seqFilter };
}

async function main() {
  const { apply, force, seqFilter } = parseArgs();
  const dataPath = path.join(__dirname, 'data', 'jd-populate-data.json');
  let rows: Row[] = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (seqFilter) rows = rows.filter((r) => seqFilter.has(r.seq));

  console.log(`Loaded ${rows.length} rows${seqFilter ? ` (filtered to --seq ${[...seqFilter].join(',')})` : ''}.`);
  if (force) console.log('--force is set: leads with an existing jd_text WILL be overwritten.');

  let toWrite = 0;
  let skippedNotBlank = 0;
  let skippedLeadMissing = 0;
  const notBlankSeqs: number[] = [];

  const plan: { row: Row; leadExists: boolean; currentBlank: boolean }[] = [];

  for (const r of rows) {
    const [lead] = await db
      .select({ id: jobLeads.id, jdText: jobLeads.jdText })
      .from(jobLeads)
      .where(and(eq(jobLeads.id, r.leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)))
      .limit(1);

    if (!lead) {
      skippedLeadMissing++;
      plan.push({ row: r, leadExists: false, currentBlank: false });
      continue;
    }

    const currentBlank = !lead.jdText || lead.jdText.trim() === '';
    plan.push({ row: r, leadExists: true, currentBlank });

    if (currentBlank || force) {
      toWrite++;
      if (!currentBlank) notBlankSeqs.push(r.seq); // will be overwritten, tracked separately below
    } else {
      skippedNotBlank++;
      notBlankSeqs.push(r.seq);
    }
  }

  console.log();
  console.log(
    `Plan: ${toWrite} leads will get jd_text written${force ? ' (including overwrites)' : ''}, ` +
      `${force ? 0 : skippedNotBlank} skipped (already has jd_text), ` +
      `${skippedLeadMissing} skipped (lead id not found in DB).`
  );
  if (notBlankSeqs.length) {
    console.log(`  Seqs with pre-existing jd_text: ${notBlankSeqs.join(', ')}${force ? ' (will be overwritten)' : ' (left untouched)'}`);
  }
  console.log();
  console.log('Excluded from this data file entirely (SharePoint folder linked to the wrong company\'s posting):');
  console.log('  seq 124 — Strategy Manager / UNIQA Insurance Group, seq 184 — Chief of Staff / Erste Digital.');
  console.log('  Both recovered instead via backfill-jd-text-from-storage.ts, from a pre-existing local capture.');

  if (!apply) {
    console.log();
    console.log('Dry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log();
  console.log('Applying...');

  let written = 0;
  for (const { row, leadExists, currentBlank } of plan) {
    if (!leadExists) continue;
    if (!currentBlank && !force) continue;
    await db
      .update(jobLeads)
      .set({ jdText: row.jdText })
      .where(and(eq(jobLeads.id, row.leadId), eq(jobLeads.ownerId, DEMO_OWNER_ID)));
    written++;
  }

  console.log(`Done. Wrote jd_text on ${written} leads.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
