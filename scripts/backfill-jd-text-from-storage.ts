/**
 * One-time backfill: for every job_lead that has raw_jd_path set but jd_text
 * blank, read the JD blob from storage and copy it into jd_text.
 *
 * Root cause: scripts/seed.ts copies "Job Descriptions/*.md" files into
 * storage and sets raw_jd_path on insert, but never set jd_text — so a large
 * number of leads have a perfectly good JD sitting in blob storage that the
 * jd_text column (and anything that reads it) has never seen. This surfaced
 * because two leads flagged as unresolvable during the SharePoint
 * reconciliation (seq 124 "Strategy Manager / UNIQA" and seq 184 "Chief of
 * Staff / Erste Digital" — both linked to a mismatched SharePoint folder)
 * turned out to already have the correct JD sitting in local storage from an
 * earlier LinkedIn-based capture, entirely independent of SharePoint.
 *
 * Run this BEFORE the migration that drops raw_jd_path (see
 * drizzle/00xx_drop_raw_jd_path.sql) — once that column is gone there's
 * nothing left to backfill from for any lead this script doesn't already
 * cover.
 *
 * This does not touch leads whose jd_text is already set (never overwrites).
 *
 * Usage:
 *   npx tsx scripts/backfill-jd-text-from-storage.ts            # dry run
 *   npx tsx scripts/backfill-jd-text-from-storage.ts --apply     # write
 */
import './_env';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';
import { readText } from '../lib/storage';

async function main() {
  const apply = process.argv.includes('--apply');

  const candidates = await db
    .select({ id: jobLeads.id, ownerId: jobLeads.ownerId, seq: jobLeads.seq, title: jobLeads.title, company: jobLeads.company, rawJdPath: jobLeads.rawJdPath, jdText: jobLeads.jdText })
    .from(jobLeads)
    .where(isNotNull(jobLeads.rawJdPath));

  const blank = candidates.filter((l) => !l.jdText || l.jdText.trim() === '');
  console.log(`${candidates.length} leads have raw_jd_path set; ${blank.length} of those have blank jd_text.`);

  let recovered = 0;
  let empty = 0;
  let failed: { seq: number | null; path: string; error: string }[] = [];

  const toWrite: { id: string; ownerId: string; text: string; seq: number | null }[] = [];

  for (const lead of blank) {
    try {
      const text = await readText(lead.rawJdPath!);
      if (!text || text.trim().length < 20) {
        empty++;
        continue;
      }
      toWrite.push({ id: lead.id, ownerId: lead.ownerId, text, seq: lead.seq });
    } catch (err) {
      failed.push({ seq: lead.seq, path: lead.rawJdPath!, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`\nRecoverable: ${toWrite.length}. Empty/too-short blob: ${empty}. Read failed (blob not found): ${failed.length}.`);
  if (failed.length) {
    console.log('Failed reads (raw_jd_path points at something that no longer exists in storage):');
    for (const f of failed.slice(0, 30)) console.log(`  seq ${f.seq ?? '?'}: ${f.path} — ${f.error}`);
    if (failed.length > 30) console.log(`  ... and ${failed.length - 30} more`);
  }

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying...');
  for (const w of toWrite) {
    await db.update(jobLeads).set({ jdText: w.text }).where(and(eq(jobLeads.id, w.id), eq(jobLeads.ownerId, w.ownerId)));
    recovered++;
  }

  console.log(`Done. Recovered jd_text for ${recovered} leads.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
