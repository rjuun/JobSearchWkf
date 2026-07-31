/**
 * One-off recovery script — 2026-07-30 data-loss incident.
 *
 * `npm run seed` was run before `Job Hunting Lists.xlsx` was present in the project root.
 * `wipeOwner()` (scripts/seed.ts) deleted every domain table for the owner, then crashed
 * loading the missing workbook before re-inserting anything from it — leaving `job_leads`
 * (and companies/offices/job_requirements/requirement_tailoring/applications/etc.) empty.
 *
 * `Job Hunting Lists.xlsx`'s own "Job Leads" sheet is NOT the right source to reseed from:
 * Reggie ran a number of reconciliation passes after that tracker was last updated, and the
 * reconciled state is more current. `Reconciliation Files/Final Reconciliation Review.xlsx`
 * → "App - Job Leads Table" is a literal row-level export of the live `job_leads` table taken
 * during that reconciliation (dated 2026-07-29, one day before the wipe) — same UUIDs, same
 * timestamps, full jd_text, every B1–B6 score/field that lives directly on the lead row.
 *
 * That sheet has an Excel Table/AutoFilter definition ExcelJS's XML parser can't handle
 * ("Unexpected xml node in parseClose: filters"), and a re-saved plain-cell copy tripped a
 * second, different ExcelJS incompatibility (worksheets not registering on read). Rather than
 * keep fighting the library, the sheet was parsed once (2026-07-30, in a Python/openpyxl
 * environment that reads it fine) straight to `Reconciliation Files/job-leads-restore.json` —
 * 156 rows, already typed (numbers as numbers, roadblocks/misalignments/skill_ratings as real
 * JSON, timestamps as ISO strings). This script reads that JSON directly; no Excel parsing at
 * runtime at all.
 *
 * Known, deliberate gap: `company_id` in the snapshot pointed at the old `companies` rows,
 * which no longer exist under those IDs (companies get fresh UUIDs whenever `npm run seed`
 * re-inserts them from the "Companies" sheet). Re-matching by name was judged riskier than
 * just leaving it null — the `company` text column is preserved verbatim, so nothing about
 * the lead's identity is lost, only the soft FK link. Flagged here rather than guessed.
 *
 * Also NOT restored by this script (no source file has this level of detail — see chat):
 *   job_requirements, requirement_tailoring, pipeline_runs, llm_calls.
 * Regenerating those means re-running B2 (Extract Requirements) + B6 (Tailoring) against the
 * restored leads.
 *
 * IMPORTANT ordering note: if `npm run seed` has already been run against `Job Hunting
 * Lists.xlsx` (its "Job Leads"/"Job Requirements" sheets), it will have inserted STALE
 * job_leads/job_requirements/requirement_tailoring rows, all pointing at each other by
 * freshly-generated ids that have nothing to do with the reconciled snapshot. This script
 * deletes job_leads AND every job_requirements/requirement_tailoring row for the same
 * owner(s) before inserting — otherwise the requirement/tailoring rows from that stale seed
 * would be left orphaned, pointing at job_lead_ids that no longer exist once this script
 * replaces them. The end state is: job_leads = the 156 reconciled rows; job_requirements /
 * requirement_tailoring = empty, ready for a clean B2 + B6 re-run.
 *
 * Run: `npx tsx scripts/restore-job-leads.ts` (add `--dry-run` to preview without writing).
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';

const ROOT = process.cwd();
const RESTORE_JSON = path.join(ROOT, 'Reconciliation Files', 'job-leads-restore.json');
const DRY_RUN = process.argv.includes('--dry-run');

type RawRow = {
  id: string;
  ownerId: string;
  createdAt: string | null;
  updatedAt: string | null;
  externalId: string | null;
  seq: number | null;
  title: string;
  company: string | null;
  city: string | null;
  sourceUrl: string | null;
  jobPostLink: string | null;
  status: string;
  postedDays: number | null;
  applicantCount: number | null;
  freshnessBand: string | null;
  saturationBand: string | null;
  analysisDate: string | null;
  roadblocks: unknown[];
  misalignments: unknown[];
  jdGroupPrimary: string | null;
  jdGroupSecondary: string | null;
  skillRatings: Record<string, number>;
  atsSystem: string | null;
  atsSpecifics: string | null;
  keyPatterns: string | null;
  scoreRelevance: number | null;
  scoreSeniority: number | null;
  scoreImpact: number | null;
  scoreReqAlignment: number | null;
  scoreAts: number | null;
  overallFitScore: number | null;
  recommendation: string | null;
  bulletBankVersion: string | null;
  isTarget: boolean;
  source: string | null;
  remote: string | null;
  jdText: string | null;
  formatSignals: string | null;
  hiringAgency: string | null;
};

function toDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log(`▶ Reading ${RESTORE_JSON}`);
  const raw = JSON.parse(fs.readFileSync(RESTORE_JSON, 'utf8')) as RawRow[];
  console.log(`  parsed ${raw.length} lead rows`);
  if (raw.length === 0) throw new Error('No rows in job-leads-restore.json — check the file before trusting this.');

  const rows: (typeof jobLeads.$inferInsert)[] = raw.map((r) => ({
    id: r.id,
    ownerId: r.ownerId,
    createdAt: toDate(r.createdAt) ?? new Date(),
    updatedAt: toDate(r.updatedAt) ?? new Date(),
    externalId: r.externalId,
    seq: r.seq,
    title: r.title || 'Untitled role',
    company: r.company,
    companyId: null, // deliberate — see file header comment
    city: r.city,
    sourceUrl: r.sourceUrl,
    jobPostLink: r.jobPostLink,
    status: (r.status || 'captured') as (typeof jobLeads.$inferInsert)['status'],
    postedDays: r.postedDays,
    applicantCount: r.applicantCount,
    freshnessBand: r.freshnessBand,
    saturationBand: r.saturationBand,
    analysisDate: r.analysisDate,
    roadblocks: r.roadblocks as never,
    misalignments: r.misalignments as never,
    jdGroupPrimary: r.jdGroupPrimary,
    jdGroupSecondary: r.jdGroupSecondary,
    skillRatings: r.skillRatings as never,
    atsSystem: r.atsSystem,
    atsSpecifics: r.atsSpecifics,
    keyPatterns: r.keyPatterns,
    scoreRelevance: r.scoreRelevance,
    scoreSeniority: r.scoreSeniority,
    scoreImpact: r.scoreImpact,
    scoreReqAlignment: r.scoreReqAlignment,
    scoreAts: r.scoreAts,
    overallFitScore: r.overallFitScore,
    recommendation: r.recommendation,
    bulletBankVersion: r.bulletBankVersion,
    isTarget: r.isTarget,
    source: r.source,
    remote: r.remote,
    jdText: r.jdText,
    formatSignals: r.formatSignals,
    hiringAgency: r.hiringAgency,
  }));

  const owners = [...new Set(rows.map((r) => r.ownerId))];
  console.log(`  owners present: ${owners.join(', ')}`);

  if (DRY_RUN) {
    console.log('— DRY RUN — sample row:');
    console.log(JSON.stringify(rows[0], null, 2));
    console.log(
      `Would delete existing job_requirements, requirement_tailoring, and job_leads for ` +
        `${owners.length} owner(s) (cleaning up anything a prior "npm run seed" stale-inserted ` +
        `that would otherwise orphan against the new lead ids), then insert ${rows.length} leads.`
    );
    return;
  }

  // Child tables first — if a prior `npm run seed` inserted stale job_requirements /
  // requirement_tailoring rows against the old (soon to be deleted) lead ids, they'd be left
  // dangling otherwise. Neither table has a better recovery source than "regenerate via B2/B6",
  // so clearing them here is a correction, not a loss beyond what already happened.
  for (const ownerId of owners) {
    const reqRes = await db.execute(sql`DELETE FROM job_requirements WHERE owner_id = ${ownerId}`);
    console.log(`  cleared job_requirements for ${ownerId} (${(reqRes as unknown as { rowCount?: number }).rowCount ?? '?'} rows)`);
    const tailRes = await db.execute(sql`DELETE FROM requirement_tailoring WHERE owner_id = ${ownerId}`);
    console.log(`  cleared requirement_tailoring for ${ownerId} (${(tailRes as unknown as { rowCount?: number }).rowCount ?? '?'} rows)`);
    const leadRes = await db.execute(sql`DELETE FROM job_leads WHERE owner_id = ${ownerId}`);
    console.log(`  cleared existing job_leads for ${ownerId} (${(leadRes as unknown as { rowCount?: number }).rowCount ?? '?'} rows)`);
  }

  await db.insert(jobLeads).values(rows);
  console.log(`✓ Restored ${rows.length} job_leads rows from the reconciliation snapshot.`);
  console.log('  job_requirements / requirement_tailoring / pipeline_runs / llm_calls are now empty —');
  console.log('  re-run screening (B2 + B6) against these leads to regenerate them.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
