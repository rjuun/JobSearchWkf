/**
 * Read-only: the WIDE version of audit-b6-collapse.
 *
 * That script scopes to leads with a `pipeline_runs` row for B6, which is the
 * right population for "did the app's B6 step collapse". It is the wrong
 * population for "does any lead in the catalogue carry a fabricated rating":
 * a lead whose scores were imported from SharePoint, or scored before run
 * recording existed, has requirement rows but no B6 run — and would never
 * appear in that sweep at all.
 *
 * So this one starts from `job_requirements` and works outward, reporting the
 * B6-run population and the no-run population separately.
 */
import './_env';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, requirementEvidence, pipelineRuns } from '../lib/db/schema';

/** The fallback signature: score 6 / "Good" with neither prose column and no evidence link. */
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
  const allReqs = await db.select().from(jobRequirements);
  const allLeads = await db.select().from(jobLeads);
  const leadById = new Map(allLeads.map((l) => [l.id, l]));

  console.log(`job_leads rows        : ${allLeads.length}`);
  console.log(`job_requirements rows : ${allReqs.length}`);

  // Which leads have ever had a B6 run recorded?
  const b6Runs = await db.select().from(pipelineRuns).where(eq(pipelineRuns.step, 'B6')).orderBy(desc(pipelineRuns.createdAt));
  const hasB6Run = new Set(b6Runs.map((r) => r.jobLeadId));
  console.log(`leads with a B6 run   : ${hasB6Run.size}`);

  const links = await db.select().from(requirementEvidence);
  const linkedReqIds = new Set(links.map((l) => l.requirementId));

  const byLead = new Map<string, typeof allReqs>();
  for (const q of allReqs) {
    const list = byLead.get(q.jobLeadId) ?? [];
    list.push(q);
    byLead.set(q.jobLeadId, list);
  }

  type Row = { leadId: string; title: string; total: number; scored: number; unjudged: number; overall: unknown; run: boolean; status: string | null };
  const rows: Row[] = [];
  for (const [leadId, list] of byLead) {
    const scored = list.filter((q) => q.initialScore != null);
    if (scored.length === 0) continue; // never scored — nothing to fabricate
    rows.push({
      leadId,
      title: leadById.get(leadId)?.title ?? '(missing lead row)',
      total: list.length,
      scored: scored.length,
      unjudged: scored.filter((q) => looksUnjudged(q) && !linkedReqIds.has(q.id)).length,
      overall: leadById.get(leadId)?.overallFitScore ?? '—',
      run: hasB6Run.has(leadId),
      status: leadById.get(leadId)?.status ?? null,
    });
  }

  const withRun = rows.filter((r) => r.run);
  const noRun = rows.filter((r) => !r.run);

  const report = (label: string, set: Row[]) => {
    console.log(`\n═══ ${label} — ${set.length} lead(s) with scored requirements`);
    const bad = set.filter((r) => r.unjudged > 0).sort((a, b) => b.unjudged - a.unjudged);
    if (bad.length === 0) {
      console.log('  ✓ none carry the fabricated 6/"Good" signature');
    } else {
      for (const r of bad) {
        console.log(`  !! ${r.title.slice(0, 44).padEnd(44)} ${String(r.scored - r.unjudged).padStart(3)}/${String(r.total).padEnd(3)} judged · overall ${r.overall} · ${r.status}`);
        console.log(`     ${r.leadId}`);
      }
    }
    const reqs = set.reduce((n, r) => n + r.unjudged, 0);
    const tot = set.reduce((n, r) => n + r.total, 0);
    console.log(`  requirements carrying a fabricated rating: ${reqs} / ${tot}`);
    return bad;
  };

  report('Scored by the app (B6 run on file)', withRun);
  const orphanBad = report('Scored WITHOUT a B6 run (imported / pre-recording)', noRun);

  if (noRun.length > 0) {
    console.log('\n  Note on the no-run set: these leads were never scored by this codebase\'s B6 step,');
    console.log('  so the collapse defect cannot be their cause. The signature there means "imported');
    console.log('  without per-requirement prose", which is a different (and expected) thing.');
    console.log(`  Leads in this set: ${noRun.length}, of which ${orphanBad.length} match the signature.`);
  }

  // Leads holding a score but with no requirement rows at all — invisible to both sweeps.
  const scoredNoReqs = allLeads.filter((l) => l.overallFitScore != null && !byLead.has(l.id));
  if (scoredNoReqs.length) {
    console.log(`\n═══ Leads with an overall_fit_score but NO requirement rows: ${scoredNoReqs.length}`);
    for (const l of scoredNoReqs.slice(0, 20)) console.log(`  ${l.title?.slice(0, 50)} · overall ${l.overallFitScore} · ${l.status}`);
    console.log('  (a score with nothing under it — worth knowing about, but not this defect)');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
