// Smoke-test the B1–B6 pipeline (mock mode) + the deterministic B6 rollup.
import './_env';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads } from '../lib/db/schema';
import { runScreening } from '../lib/pipeline/screening';
import { overallFit } from '../lib/scoring';

async function main() {
  const [lead] = await db.select().from(jobLeads).where(isNotNull(jobLeads.rawJdPath)).limit(1);
  if (!lead) throw new Error('no lead with a captured JD found — run npm run seed');
  console.log(`Lead: ${lead.title} · ${lead.company ?? ''}  (${lead.id})\n`);

  const reports = await runScreening(lead.id);
  for (const r of reports) console.log(`  ${r.step}  ${r.label.padEnd(26)} ${r.summary.padEnd(34)} [${r.model}, ${r.ms}ms]`);

  const [after] = await db.select().from(jobLeads).where(eq(jobLeads.id, lead.id));
  const dims = {
    relevance: after.scoreRelevance ?? 0,
    seniority: after.scoreSeniority ?? 0,
    impact: after.scoreImpact ?? 0,
    reqAlignment: after.scoreReqAlignment ?? 0,
    ats: after.scoreAts ?? 0,
  };
  const recomputed = overallFit(dims);
  console.log('\n  dimensions:', dims);
  console.log(`  persisted overall: ${after.overallFitScore}   recomputed: ${recomputed}`);
  console.log(`  recommendation: ${after.recommendation}   status: ${after.status}`);
  const ok = Math.abs((after.overallFitScore ?? -1) - recomputed) < 0.05;
  console.log(ok ? '\n✓ overall matches the deterministic rollup' : '\n✗ MISMATCH');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
