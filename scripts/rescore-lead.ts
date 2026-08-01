/**
 * Re-run the scoring half (B5 → B6) on ONE lead and print what changed.
 *
 * §2.5 of the CI "B6 Never Receives the Master Bullet Bank" asks for exactly this:
 * re-score one lead and sanity-check the movement against a human reading. The
 * batch runner (`batch-screen.ts`) deliberately skips leads that already have a
 * score, so there was no way to do it for a single already-screened lead.
 *
 * Costs real Anthropic calls (one Sonnet for B5, one Opus for B6) and OVERWRITES
 * this lead's stored score, requirement judgments and evidence links — which is why
 * it prints a before/after and requires --apply rather than doing it on sight.
 *
 * Usage:
 *   npx tsx scripts/rescore-lead.ts <leadId>            # show current state, change nothing
 *   npx tsx scripts/rescore-lead.ts <leadId> --apply    # re-run B5 + B6
 */
import './_env';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, requirementEvidence } from '../lib/db/schema';
import { runScoring } from '../lib/pipeline/screening';
import { isLiveLlm, env } from '../lib/env';

async function snapshot(leadId: string) {
  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const reqs = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, lead.ownerId)));
  const links = await db
    .select()
    .from(requirementEvidence)
    .where(and(eq(requirementEvidence.jobLeadId, leadId), eq(requirementEvidence.ownerId, lead.ownerId)));
  return { lead, reqs, links };
}

function report(label: string, s: Awaited<ReturnType<typeof snapshot>>) {
  const { lead, reqs, links } = s;
  console.log(`\n── ${label} ──`);
  console.log(`  overall_fit_score   ${lead.overallFitScore} / 10  (${lead.recommendation})`);
  console.log(`  score_req_alignment ${lead.scoreReqAlignment}`);
  console.log(`  bullet_bank_version ${lead.bulletBankVersion}`);
  console.log(`  requirements        ${reqs.length}  ·  scored ${reqs.filter((r) => r.initialScore != null).length}`);
  console.log(`  key strengths set   ${reqs.filter((r) => r.initialKeyStrengths).length}/${reqs.length}`);
  console.log(`  missing/weak set    ${reqs.filter((r) => r.initialMissingWeak).length}/${reqs.length}`);
  console.log(`  evidence links      ${links.length}  across ${new Set(links.map((l) => l.requirementId)).size} requirement(s)`);
  const noMatch = reqs.filter((r) => r.initialMatchStrength === 'No Match');
  console.log(`  No Match            ${noMatch.length}  ·  with a stated reason ${noMatch.filter((r) => r.initialMissingWeak).length}`);
}

async function main() {
  const leadId = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!leadId) throw new Error('usage: npx tsx scripts/rescore-lead.ts <leadId> [--apply]');

  const before = await snapshot(leadId);
  console.log(`\nLead: ${before.lead.title}${before.lead.company ? ` · ${before.lead.company}` : ''}  (${before.lead.status})`);
  report('BEFORE', before);

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to spend the calls.\n');
    return;
  }
  if (!isLiveLlm) console.warn(`\n! LLM_MODE=${env.llmMode} — this will write MOCK judgments over a real lead.\n`);

  await runScoring(leadId, before.lead.ownerId);
  const after = await snapshot(leadId);
  report('AFTER', after);

  // The per-requirement detail is the point of the exercise: §2.5 asks for a human
  // sanity-check of the movement, and a single overall number can't be checked.
  console.log('\n── Per-requirement, after ──');
  const byReq = new Map<string, string[]>();
  for (const l of after.links) byReq.set(l.requirementId, [...(byReq.get(l.requirementId) ?? []), l.evidenceRef]);
  for (const r of [...after.reqs].sort((a, b) => (a.requirementOrder ?? 0) - (b.requirementOrder ?? 0))) {
    const refs = byReq.get(r.id) ?? [];
    console.log(
      `  ${String(r.requirementOrder ?? '?').padStart(2)}. [${(r.rank ?? '?').padEnd(12)}] ` +
        `${String(r.initialScore ?? '—').padStart(4)} ${(r.initialMatchStrength ?? '—').padEnd(12)} ` +
        `${refs.length ? refs.join(', ') : '(no evidence)'}  ${r.requirement.slice(0, 60)}`
    );
    if (r.initialMissingWeak) console.log(`        gap: ${r.initialMissingWeak.slice(0, 150)}`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
