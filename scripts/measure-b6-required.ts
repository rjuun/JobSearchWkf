/**
 * The before/after measurement §2.5 asks for, run against a REAL lead and a REAL
 * model — and deliberately READ-ONLY: it calls B6 directly rather than through
 * `runScoring`, so nothing is written to `job_leads`, `job_requirements` or
 * `requirement_evidence`. The lead's stored score is untouched no matter how many
 * times this runs. The only rows it creates are `llm_calls` audit rows, which is
 * where it reads its own numbers back from.
 *
 * Why it exists: the sibling CI established that under `strict: true` an
 * INCOMPLETE `required` list degrades the constrained grammar rather than making
 * fields optional, and that the resulting collapse is PROBABILISTIC — B2 went from
 * ~0/17 to 13/14, which a single run either side could not have shown. So each
 * variant is run several times and reported as a distribution, not a verdict.
 *
 * Three variants. **All three declare the evidence properties** — only `required`
 * and the presence of the bank vary. None of them is the true pre-CI schema, in
 * which `evidenceRefs`/`evidenceNote` did not exist at all; that schema worked, and
 * this script is not evidence that it didn't. What is under test is the change
 * being made: what happens when you ADD properties to a strict schema, with and
 * without adding them to `required`.
 *
 *   nobank    properties declared but not required, and no bank in the user message.
 *             Its input-token count is the baseline the first acceptance criterion
 *             measures the rise against. Not sampled — see the loop below.
 *   partial   bank sent, properties declared but not required — the trap this change
 *             would have fallen into.
 *   complete  what shipped: bank sent, `required` complete.
 *
 * Usage:  npx tsx scripts/measure-b6-required.ts <leadId> [runsPerVariant]
 */
import './_env';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, llmCalls } from '../lib/db/schema';
import { systemPromptFor } from '../lib/prompts';
import { runStructured } from '../lib/llm/client';
import { B6 } from '../lib/llm/schemas';
import { gatherB6Evidence, renderB6Evidence } from '../lib/pipeline/screening';
import { isLiveLlm, env } from '../lib/env';

type Variant = 'nobank' | 'partial' | 'complete';

/** B6's `required` lists exactly as they stood before this CI (lib/llm/schemas.ts, pre-0032). */
const PRE_CI_ROOT_REQUIRED = ['relevance', 'seniority', 'impact', 'ats', 'requirements'];
const PRE_CI_ITEM_REQUIRED = ['order', 'requirement', 'score', 'matchStrength'];

function toolFor(variant: Variant) {
  if (variant === 'complete') return B6.tool;
  // Structured clone, then downgrade only the two `required` arrays. Every property
  // — including the new evidence fields — stays DECLARED. That is the comparison
  // that matters: the pre-CI schema, which also had these `required` lists, did not
  // declare `evidenceRefs`/`evidenceNote` at all and generated fine, so the variable
  // under test is the mismatch between what is declared and what is required, not
  // the `required` list in isolation.
  const schema = JSON.parse(JSON.stringify(B6.tool.input_schema));
  schema.required = PRE_CI_ROOT_REQUIRED;
  schema.properties.requirements.items.required = PRE_CI_ITEM_REQUIRED;
  return { ...B6.tool, input_schema: schema };
}

type Row = { variant: Variant; run: number; reqs: number; withEvidence: number; refs: number; noMatchWithReason: number; inTok: number; cacheR: number; cacheW: number; outTok: number; stop: string | null };

async function main() {
  const leadId = process.argv[2];
  const runs = Number(process.argv[3] ?? 4);
  if (!leadId) throw new Error('usage: npx tsx scripts/measure-b6-required.ts <leadId> [runsPerVariant]');
  if (!isLiveLlm) throw new Error(`this measurement is meaningless in mock mode (LLM_MODE=${env.llmMode})`);

  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const owner = lead.ownerId;
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, owner)));
  const { items: evidence, bankVersion } = await gatherB6Evidence(owner);
  const jd = lead.jdText ?? '';
  const system = await systemPromptFor('B6', owner);
  const reqList = requirements.map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`).join('\n');
  const bankRefs = new Set(evidence.map((e) => e.ref));

  console.log(`\nLead: ${lead.title}${lead.company ? ` · ${lead.company}` : ''}`);
  console.log(`Requirements on file: ${requirements.length} · bank items: ${evidence.length} (version ${bankVersion}) · ${runs} run(s) per variant\n`);

  const rows: Row[] = [];
  for (const variant of ['nobank', 'partial', 'complete'] as Variant[]) {
    // `nobank` exists to establish the token baseline, not to be sampled — its
    // schema is identical to `partial`, so its requirement count carries no
    // information `partial` doesn't already give at n=4, and its input-token count
    // does not vary between runs.
    const n = variant === 'nobank' ? 1 : runs;
    for (let i = 1; i <= n; i++) {
      const user =
        variant === 'nobank'
          ? `JOB DESCRIPTION:\n${jd || lead.title}\n\nREQUIREMENTS:\n${reqList}\n\nFor each requirement, set "order" to its number above.`
          : [
              { type: 'text' as const, text: renderB6Evidence(evidence), cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } },
              {
                type: 'text' as const,
                text:
                  `JOB DESCRIPTION:\n${jd || lead.title}\n\nREQUIREMENTS:\n${reqList}\n\n` +
                  `For each requirement, set "order" to its number above and list in "evidenceRefs" every ref code ` +
                  `from CANDIDATE EVIDENCE that genuinely supports it — several where several apply, none where none do. ` +
                  `Cite only codes that appear in that list. Where nothing supports the requirement, use "No Match", ` +
                  `leave "evidenceRefs" empty, and state in "gaps" what is missing.`,
              },
            ];

      let reqs = 0;
      let withEvidence = 0;
      let refs = 0;
      let noMatchWithReason = 0;
      try {
        const r = await runStructured({
          step: `B6-measure-${variant}`,
          model: 'opus',
          system,
          user,
          tool: toolFor(variant),
          zod: B6.zod,
          mock: () => ({ relevance: 0, seniority: 0, impact: 0, ats: 0, requirements: [], summary: '' }),
          leadId,
          ownerId: owner,
        });
        reqs = r.data.requirements.length;
        for (const q of r.data.requirements) {
          const cited = (q.evidenceRefs ?? []).filter((x) => bankRefs.has(x.trim()));
          if (cited.length) withEvidence++;
          refs += cited.length;
          if (q.matchStrength === 'No Match' && (q.gaps ?? '').trim().length > 0) noMatchWithReason++;
        }
      } catch (err) {
        console.error(`  ${variant} run ${i}: FAILED — ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
      }

      const [call] = await db
        .select()
        .from(llmCalls)
        .where(and(eq(llmCalls.jobLeadId, leadId), eq(llmCalls.step, `B6-measure-${variant}`)))
        .orderBy(desc(llmCalls.createdAt))
        .limit(1);
      rows.push({
        variant, run: i, reqs, withEvidence, refs, noMatchWithReason,
        inTok: call?.inputTokens ?? 0,
        cacheR: call?.cacheReadTokens ?? 0,
        cacheW: call?.cacheCreationTokens ?? 0,
        outTok: call?.outputTokens ?? 0,
        stop: call?.stopReason ?? null,
      });
      const r = rows[rows.length - 1];
      console.log(
        `  ${variant.padEnd(8)} run ${i}: ${String(r.reqs).padStart(2)}/${requirements.length} reqs · ` +
          `${String(r.withEvidence).padStart(2)} with evidence · ${String(r.refs).padStart(3)} refs · ` +
          `in=${r.inTok} cache[w=${r.cacheW} r=${r.cacheR}] out=${r.outTok} stop=${r.stop}`
      );
    }
  }

  console.log('\n── Summary ─────────────────────────────────────────────────────');
  for (const variant of ['nobank', 'partial', 'complete'] as Variant[]) {
    const v = rows.filter((r) => r.variant === variant);
    if (!v.length) continue;
    const sum = (f: (r: Row) => number) => v.reduce((a, r) => a + f(r), 0);
    // Total input = fresh + cache write + cache read. Anthropic reports `in=`
    // NET of cache, so comparing raw `in=` across a cached and an uncached call
    // would understate the bank's real cost rather than measure it.
    const totalIn = (r: Row) => r.inTok + r.cacheW + r.cacheR;
    console.log(
      `${variant.padEnd(8)} n=${v.length} · reqs ${v.map((r) => r.reqs).join('/')} ` +
        `· complete ${v.filter((r) => r.reqs === requirements.length).length}/${v.length} ` +
        `· with-evidence ${v.map((r) => r.withEvidence).join('/')} ` +
        `· No-Match-with-reason ${sum((r) => r.noMatchWithReason)} ` +
        `· mean total input ${Math.round(sum(totalIn) / v.length)} tok (mean out ${Math.round(sum((r) => r.outTok) / v.length)})`
    );
  }
  console.log('\nNothing was written to this lead — scores, requirements and evidence links are unchanged.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
