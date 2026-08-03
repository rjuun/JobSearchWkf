/**
 * Read-only audit: how often has a collapsed B6 generation already been persisted?
 *
 * A "collapse" is the failure the B2 CI documented, now observed on B6: under
 * `strict: true` the model returns a near-empty `requirements` array, which is
 * schema-valid, so runStructured's retry never fires and the pipeline proceeds.
 *
 * The persisted fingerprint. `perReq` in the B6 block maps EVERY requirement row,
 * so an unjudged row is not left blank — it takes the fallbacks:
 *     score          ?? 6
 *     matchStrength  ?? matchStrengthForScore(6) === 'Good'
 *     keyStrengths   -> null   (nullIfBlank of undefined)
 *     gaps           -> null
 *     refs           -> []     (no requirement_evidence row)
 * So a row scored exactly 6 / 'Good' with BOTH prose columns null and no evidence
 * link is a requirement the model never actually judged, recorded as a middling
 * pass. That combination is what this script counts.
 *
 * It only SELECTs. Nothing is written, and no lead's score is touched.
 */
import './_env';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, requirementEvidence, pipelineRuns } from '../lib/db/schema';

/** The fallback signature above. Kept as one predicate so the rationale stays in one place. */
function looksUnjudged(r: {
  initialScore: unknown;
  initialMatchStrength: string | null;
  initialKeyStrengths: string | null;
  initialMissingWeak: string | null;
}): boolean {
  return (
    Number(r.initialScore) === 6 &&
    (r.initialMatchStrength === 'Good' || r.initialMatchStrength == null) &&
    r.initialKeyStrengths == null &&
    r.initialMissingWeak == null
  );
}

async function main() {
  // Every lead that has actually been through B6 — a B6 pipeline_runs row is the
  // only reliable marker (job_leads.status moves on afterwards).
  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.step, 'B6'))
    .orderBy(desc(pipelineRuns.createdAt));

  console.log(`B6 pipeline_runs rows: ${runs.length}`);
  if (runs.length === 0) return;

  // Latest run per lead — earlier ones were overwritten by the re-score that followed.
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latest.has(r.jobLeadId)) latest.set(r.jobLeadId, r);
  const leadIds = [...latest.keys()];
  console.log(`distinct leads scored by B6: ${leadIds.length}\n`);

  const leads = await db.select().from(jobLeads).where(inArray(jobLeads.id, leadIds));
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const reqs = await db.select().from(jobRequirements).where(inArray(jobRequirements.jobLeadId, leadIds));
  const reqsByLead = new Map<string, typeof reqs>();
  for (const q of reqs) {
    const list = reqsByLead.get(q.jobLeadId) ?? [];
    list.push(q);
    reqsByLead.set(q.jobLeadId, list);
  }

  const links = await db
    .select()
    .from(requirementEvidence)
    .where(inArray(requirementEvidence.jobLeadId, leadIds));
  const linkedReqIds = new Set(links.map((l) => l.requirementId));

  type Row = {
    leadId: string;
    title: string;
    when: string;
    total: number;
    unjudged: number;
    judged: number;
    coverage: number;
    evidenceLinks: unknown;
    overall: unknown;
    recommendation: string | null;
  };
  const rows: Row[] = [];

  for (const leadId of leadIds) {
    const run = latest.get(leadId)!;
    const lead = leadById.get(leadId);
    const list = reqsByLead.get(leadId) ?? [];
    if (list.length === 0) continue; // nothing to collapse against

    // A row with an evidence link was demonstrably judged, whatever its columns say.
    const unjudged = list.filter((q) => looksUnjudged(q) && !linkedReqIds.has(q.id)).length;
    const judged = list.length - unjudged;
    rows.push({
      leadId,
      title: lead?.title ?? '(lead row missing)',
      when: run.createdAt ? new Date(run.createdAt).toISOString().slice(0, 10) : '—',
      total: list.length,
      unjudged,
      judged,
      coverage: list.length === 0 ? 1 : judged / list.length,
      evidenceLinks: (run.output as Record<string, unknown> | null)?.evidenceLinks ?? '—',
      overall: lead?.overallFitScore ?? '—',
      recommendation: lead?.recommendation ?? null,
    });
  }

  rows.sort((a, b) => a.coverage - b.coverage);

  const collapsed = rows.filter((r) => r.coverage < 1);
  const severe = rows.filter((r) => r.coverage < 0.5);

  console.log('lead                                   date        judged/total  cov   links  overall  recommendation');
  console.log('─'.repeat(118));
  for (const r of rows) {
    const flag = r.coverage < 0.5 ? '!!' : r.coverage < 1 ? ' !' : '  ';
    console.log(
      `${flag} ${r.title.slice(0, 34).padEnd(34)} ${r.when}  ` +
        `${String(r.judged).padStart(4)}/${String(r.total).padEnd(4)}  ` +
        `${(r.coverage * 100).toFixed(0).padStart(3)}%  ` +
        `${String(r.evidenceLinks).padStart(4)}  ` +
        `${String(r.overall).padStart(6)}  ${r.recommendation ?? '—'}`
    );
  }

  console.log('\n─── summary ───');
  console.log(`leads with requirements scored by B6 : ${rows.length}`);
  console.log(`fully judged (coverage 100%)         : ${rows.length - collapsed.length}`);
  console.log(`partial collapse (coverage < 100%)   : ${collapsed.length}`);
  console.log(`severe collapse  (coverage < 50%)    : ${severe.length}`);
  const affectedReqs = rows.reduce((n, r) => n + r.unjudged, 0);
  const totalReqs = rows.reduce((n, r) => n + r.total, 0);
  console.log(`requirements carrying a fallback 6/'Good' they were never judged for: ${affectedReqs} / ${totalReqs}`);
  if (severe.length) {
    console.log('\nSeverely collapsed leads (their overall_fit_score is computed from a handful of real judgments):');
    for (const r of severe) console.log(`  ${r.leadId}  ${r.title}  — ${r.judged}/${r.total}, overall ${r.overall}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
