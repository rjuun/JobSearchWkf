/**
 * Fourth and final follow-up to scripts/restore-job-leads.ts — 2026-07-30.
 *
 * Reggie hand-reconciled the SharePoint "Job Leads Table" himself this time (the
 * `reconciliation_tbl` formatted table on the "Sharepoint - Job Leads Table" tab of
 * `Final Reconciliation Review.xlsx`, exported to CSV to sidestep the ExcelJS Table/AutoFilter
 * crash that broke the original restore — see restore-job-leads.ts's header) and it's the
 * authoritative source now: 157 leads, every one of them classified. It **supersedes**
 * `scripts/reconcile-applications.ts` (which only covered a 96-lead subset built from a stale
 * partial reconciliation) — don't run that one again after this.
 *
 * Reads `Reconciliation Files/Final Reconciliation File 2026 07 20.csv` directly — semicolon-
 * delimited, with quoted multi-line cells (e.g. the Mercer row's Misalignments field), so this
 * ships its own small RFC4180-ish parser rather than assume a clean one-line-per-row shape.
 *
 * Column → field mapping (matched by position, header read once for a sanity check, not used
 * for lookup — the export has two blank-named trailing columns and some duplicate-ish headers):
 *   1  ID               → seq (join key against job_leads.seq)
 *   4  City              → jobLeads.city
 *   7  Roadblocks        → informational only; the DB's own jobLeads.roadblocks (populated by
 *                          the B3 pipeline step) is the structured source of truth, not this text
 *   8  Misalignments     → same, informational only (B4's jobLeads.misalignments is the real one)
 *   35 Process Status    → drives everything below
 *   36 Application Date  → applications.appliedAt
 *   45 Process Closed    → applications.outcomeAt
 *   46 Email Address     → applications.contactEmail
 *   47 Email Response    → folded into applications.outcomeNotes (free text, e.g. "Open Email" —
 *                          no real link/attachment came through in this export, unlike the
 *                          SharePoint Applications-library folder IDs the original 91 had)
 *
 * Process Status → (jobLeads.status, applications row):
 *   "0 - Screening"                          → screening,   no application row
 *   "3 - Application Response Pending" (22)  → applied,     applications.status='response_pending'
 *   "9 - Stopped" (104)                      → archived,    applications.status='screened_out'
 *   "Discarded (Roadblock or Misalignment)"  → not_pursued, no application row (12)
 *   "Not Proceeding" (9)                     → not_pursued, no application row
 * `not_pursued` is the new status added to leadStatusEnum this session (lib/db/schema.ts) —
 * one terminal bucket for "never applied," with the *why* read off the lead's existing
 * roadblocks/misalignments (empty on both → shows as "Not proceeding" — see
 * lib/queries.ts listNotPursuedLeads). Deliberately does NOT touch jobLeads.roadblocks/
 * misalignments — those already hold the real, structured B3/B4 data; this script only sets
 * the status that groups them for browsing.
 *
 * Safety: for every row that gets an application (Process Status 3 or 9), deletes any existing
 * applications row for that (owner, leadId) first — harmless if empty, correct if the earlier,
 * superseded reconcile-applications.ts run left something behind.
 *
 * Run: `npx tsx scripts/reconcile-job-leads-from-csv.ts` (add `--dry-run` to preview).
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { applications, jobLeads } from '../lib/db/schema';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'Reconciliation Files', 'Final Reconciliation File 2026 07 20.csv');
const DRY_RUN = process.argv.includes('--dry-run');

// ── A small semicolon-delimited RFC4180-ish parser ──────────────────────────
// Handles quoted fields, embedded delimiters/newlines inside quotes, and ""
// as an escaped literal quote. Good enough for this one file; not a general
// CSV library.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ';') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Last field/row, if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// DD.MM.YYYY, optionally with " HH:MM" trailing (Modified/Created use that; not parsed here).
function parseDdMmYyyy(v: string): Date | null {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(d.getTime()) ? null : d;
}

type Mapped = {
  seq: number;
  city: string | null;
  processStatus: string;
  leadStatus: 'screening' | 'applied' | 'archived' | 'not_pursued' | null;
  appStatus: 'response_pending' | 'screened_out' | null;
  appliedAt: Date | null;
  outcomeAt: Date | null;
  contactEmail: string | null;
  outcomeNotes: string | null;
};

function mapProcessStatus(raw: string): { leadStatus: Mapped['leadStatus']; appStatus: Mapped['appStatus'] } {
  const s = raw.trim();
  if (s === '0 - Screening') return { leadStatus: 'screening', appStatus: null };
  if (s === '3 - Application Response Pending') return { leadStatus: 'applied', appStatus: 'response_pending' };
  if (s === '9 - Stopped') return { leadStatus: 'archived', appStatus: 'screened_out' };
  if (s.startsWith('Discarded')) return { leadStatus: 'not_pursued', appStatus: null };
  if (s === 'Not Proceeding') return { leadStatus: 'not_pursued', appStatus: null };
  return { leadStatus: null, appStatus: null }; // blank / unrecognised — leave the lead untouched
}

async function main() {
  console.log(`▶ Reading ${CSV_PATH}`);
  const text = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
  const table = parseCsv(text);
  const [header, ...dataRows] = table;
  console.log(`  ${dataRows.length} data rows (header has ${header.length} columns)`);
  if (header[1]?.trim() !== 'ID' || header[35]?.trim() !== 'Process Status') {
    throw new Error(
      `Column layout doesn't match what this script expects (header[1]="${header[1]}", header[35]="${header[35]}"). ` +
        `Re-check the export before trusting this run.`
    );
  }

  const mapped: Mapped[] = [];
  const statusTally = new Map<string, number>();
  const unrecognised: { seq: number; status: string }[] = [];

  for (const r of dataRows) {
    const seq = Number(r[1]);
    if (!Number.isFinite(seq)) continue; // stray/blank row
    const processStatus = (r[35] ?? '').trim();
    const { leadStatus, appStatus } = mapProcessStatus(processStatus);
    statusTally.set(processStatus, (statusTally.get(processStatus) ?? 0) + 1);
    if (!leadStatus) {
      if (processStatus) unrecognised.push({ seq, status: processStatus });
      continue;
    }
    const emailResponse = (r[47] ?? '').trim();
    const emailAddress = (r[46] ?? '').trim();
    mapped.push({
      seq,
      city: (r[4] ?? '').trim() || null,
      processStatus,
      leadStatus,
      appStatus,
      appliedAt: parseDdMmYyyy(r[36] ?? ''),
      outcomeAt: parseDdMmYyyy(r[45] ?? ''),
      contactEmail: emailAddress || null,
      outcomeNotes: appStatus
        ? `SharePoint reconciliation import (2026-07-20 export) — Process Status: ${processStatus}` +
          (emailResponse ? `; Email Response: ${emailResponse}` : '')
        : null,
    });
  }

  console.log('  Process Status tally:', Object.fromEntries(statusTally));
  if (unrecognised.length > 0) {
    console.log(`  ! ${unrecognised.length} rows had an unrecognised Process Status — left untouched:`, unrecognised);
  }

  if (DRY_RUN) {
    console.log('— DRY RUN — sample of what would be written:');
    for (const m of mapped.slice(0, 5)) console.log(' ', m);
    const byLeadStatus = new Map<string, number>();
    for (const m of mapped) byLeadStatus.set(m.leadStatus!, (byLeadStatus.get(m.leadStatus!) ?? 0) + 1);
    console.log(`Total: ${mapped.length} leads would be updated.`, Object.fromEntries(byLeadStatus));
    return;
  }

  let updated = 0;
  let appsWritten = 0;
  let notFound = 0;
  for (const m of mapped) {
    const [lead] = await db.select({ id: jobLeads.id, ownerId: jobLeads.ownerId }).from(jobLeads).where(eq(jobLeads.seq, m.seq));
    if (!lead) {
      notFound += 1;
      console.log(`  ! seq ${m.seq} not found in job_leads — skipped`);
      continue;
    }

    await db
      .update(jobLeads)
      .set({ status: m.leadStatus!, city: m.city ?? undefined, updatedAt: new Date() })
      .where(and(eq(jobLeads.id, lead.id), eq(jobLeads.ownerId, lead.ownerId)));
    updated += 1;

    if (m.appStatus) {
      await db.delete(applications).where(and(eq(applications.ownerId, lead.ownerId), eq(applications.jobLeadId, lead.id)));
      await db.insert(applications).values({
        ownerId: lead.ownerId,
        jobLeadId: lead.id,
        appliedAt: m.appliedAt ?? new Date(),
        status: m.appStatus,
        outcomeAt: m.outcomeAt,
        contactEmail: m.contactEmail,
        outcomeNotes: m.outcomeNotes,
      });
      appsWritten += 1;
    }
  }

  console.log(`✓ Updated ${updated} job_leads (status + city), wrote ${appsWritten} applications rows.`);
  if (notFound > 0) console.log(`  ${notFound} CSV rows had no matching seq in job_leads — see log above.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
