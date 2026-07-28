/**
 * Second-pass jd_text recovery, run after raw_jd_path was dropped from the
 * schema. backfill-jd-text-from-storage.ts (the first pass) read the blob
 * at whatever raw_jd_path held in the DB — if that value was itself odd
 * (e.g. a Windows-backslash path, or something that just didn't resolve for
 * some other reason) that lead would have been silently skipped as a failed
 * read, and now there's no raw_jd_path column left to tell us where its blob
 * used to be.
 *
 * This script sidesteps that entirely: it doesn't look at any DB column for
 * the path. It goes straight to the two naming conventions actually used on
 * disk under STORAGE_DIR/jd-captures/:
 *   - {seq}/raw.md       — scripts/seed.ts's convention (bulk Excel import)
 *   - {leadId}/raw.md    — lib/pipeline/capture.ts's convention (live capture)
 * and tries both for every lead whose jd_text is still blank.
 *
 * Reports a clear breakdown at the end: recovered, and any leads with no
 * blob under either convention (which likely never had a JD captured at all,
 * and would need to be manually pasted/re-captured in the app).
 *
 * Usage:
 *   npx tsx scripts/backfill-jd-text-v2.ts            # dry run
 *   npx tsx scripts/backfill-jd-text-v2.ts --apply     # write
 */
import './_env';
import { and, eq, or, isNull, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';
import { readText } from '../lib/storage';

async function main() {
  const apply = process.argv.includes('--apply');

  const blank = await db
    .select({ id: jobLeads.id, ownerId: jobLeads.ownerId, seq: jobLeads.seq, title: jobLeads.title, company: jobLeads.company, jdText: jobLeads.jdText })
    .from(jobLeads)
    .where(or(isNull(jobLeads.jdText), sql`trim(${jobLeads.jdText}) = ''`));

  console.log(`${blank.length} leads currently have blank jd_text. Checking storage for each...`);

  const recovered: { id: string; ownerId: string; text: string; seq: number | null; via: string }[] = [];
  const notFound: { seq: number | null; title: string; company: string | null }[] = [];

  for (const lead of blank) {
    let text: string | null = null;
    let via = '';
    if (lead.seq != null) {
      try {
        const t = await readText(`jd-captures/${lead.seq}/raw.md`);
        if (t && t.trim().length >= 20) {
          text = t;
          via = `seq/${lead.seq}`;
        }
      } catch {
        /* not found under the seq convention, try the leadId one below */
      }
    }
    if (!text) {
      try {
        const t = await readText(`jd-captures/${lead.id}/raw.md`);
        if (t && t.trim().length >= 20) {
          text = t;
          via = `leadId/${lead.id}`;
        }
      } catch {
        /* not found under either convention */
      }
    }
    if (text) {
      recovered.push({ id: lead.id, ownerId: lead.ownerId, text, seq: lead.seq, via });
    } else {
      notFound.push({ seq: lead.seq, title: lead.title, company: lead.company });
    }
  }

  console.log(`\nRecoverable from storage: ${recovered.length}.`);
  for (const r of recovered.slice(0, 20)) console.log(`  seq ${r.seq ?? '?'} — via ${r.via} (${r.text.length} chars)`);
  if (recovered.length > 20) console.log(`  ... and ${recovered.length - 20} more`);

  console.log(`\nNo blob found under either convention (likely never had a JD captured): ${notFound.length}.`);
  for (const n of notFound.slice(0, 40)) console.log(`  seq ${n.seq ?? '?'}: ${n.title} — ${n.company ?? 'no company'}`);
  if (notFound.length > 40) console.log(`  ... and ${notFound.length - 40} more`);

  if (!apply) {
    console.log('\nDry run only — no changes written. Re-run with --apply to commit.');
    process.exit(0);
  }

  console.log('\nApplying...');
  let written = 0;
  for (const r of recovered) {
    await db.update(jobLeads).set({ jdText: r.text }).where(and(eq(jobLeads.id, r.id), eq(jobLeads.ownerId, r.ownerId)));
    written++;
  }
  console.log(`Done. Recovered jd_text for ${written} leads.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
