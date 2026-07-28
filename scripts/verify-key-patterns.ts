/**
 * The one §2.4 criterion verify-scoring-queue.ts deliberately can't prove:
 *
 *   "Every lead scored after this ships has a non-null job_leads.key_patterns
 *    whenever B4's live response included `notes` (verify against
 *    pipeline_runs.output for the B4 step)."
 *
 * That needs a real model response, because mock mode's mockSkillMapping()
 * hardcodes `notes: null` (lib/pipeline/screening.ts) — which only ever
 * exercises the `?? lead.keyPatterns` preservation half of the write. So this
 * script runs LIVE, on purpose, on exactly one throwaway lead, and checks the
 * two things the mock run leaves open:
 *
 *   1. B4's live response actually carries `notes` (the B4 process note asks for
 *      it and the tool schema returns it — §1 of the CI argued the model was
 *      already producing text the write path dropped; this is what confirms it).
 *   2. That exact text landed in job_leads.key_patterns, compared against the
 *      recorded pipeline_runs.output rather than merely "is non-null".
 *
 * Costs three live calls (B4+B5+B6). Everything it creates, it deletes.
 */
import './_env';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, pipelineRuns, llmCalls } from '../lib/db/schema';
import { runScoring } from '../lib/pipeline/screening';
import { isLiveLlm, env } from '../lib/env';

const OWNER = '00000000-0000-0000-0000-0000000ffff2'; // throwaway, not DEMO_OWNER_ID

const JD = `Senior Programme Manager — Finance Transformation (Vienna, hybrid)

You will lead a multi-year finance transformation portfolio across our European entities, owning the
delivery roadmap end to end and reporting progress directly to the CFO and the steering committee.
Responsibilities: sequencing workstreams, tracking benefits realisation, managing a team of four
project managers, and holding senior stakeholders to account on the commitments they have made.
We are looking for someone with a track record of running large, cross-border change programmes in a
finance context, strong stakeholder management, and comfort operating in ambiguity. Experience with
ERP migrations and with building reporting capability from scratch is a clear advantage. German is
useful but not required; the working language of the programme is English.`;

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

async function cleanup() {
  const rows = await db.select({ id: jobLeads.id }).from(jobLeads).where(eq(jobLeads.ownerId, OWNER));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(pipelineRuns).where(inArray(pipelineRuns.jobLeadId, ids));
    await db.delete(llmCalls).where(inArray(llmCalls.jobLeadId, ids));
    await db.delete(jobRequirements).where(inArray(jobRequirements.jobLeadId, ids));
  }
  await db.delete(jobLeads).where(eq(jobLeads.ownerId, OWNER));
  return ids.length;
}

async function main() {
  if (!isLiveLlm) {
    console.error(
      `\nThis script only means anything in live mode — mock always returns notes=null.\n` +
        `  LLM_MODE=${env.llmMode}, ANTHROPIC_API_KEY ${env.anthropicApiKey ? 'set' : 'MISSING'}\n`
    );
    process.exit(2);
  }

  await cleanup(); // in case a previous run died mid-way

  console.log('\n§2.4 · B4 `notes` reaches job_leads.key_patterns on a live call');
  const [row] = await db
    .insert(jobLeads)
    .values({ ownerId: OWNER, title: 'Senior Programme Manager — Finance Transformation', jdText: JD, status: 'selected', postedDays: 4, city: 'Vienna' })
    .returning({ id: jobLeads.id });

  await runScoring(row.id, OWNER);

  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, row.id));
  const [b4] = await db
    .select({ output: pipelineRuns.output })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.jobLeadId, row.id), eq(pipelineRuns.step, 'B4')));

  const notes = (b4?.output as { notes?: string | null } | null)?.notes ?? null;

  check('B4 recorded a run', b4 != null);
  check('the live B4 response carried `notes`', typeof notes === 'string' && notes.trim().length > 0, notes ? `${notes.length} chars` : 'notes=null');
  check(
    'and that exact text is what landed in key_patterns',
    lead.keyPatterns === notes,
    lead.keyPatterns === notes ? 'match' : `key_patterns=${JSON.stringify(lead.keyPatterns)} vs notes=${JSON.stringify(notes)}`
  );
  check('the lead finished scoring', lead.status === 'screened' || lead.status === 'hold', `status=${lead.status}`);

  if (notes) console.log(`\n  key patterns as written:\n  "${notes}"`);

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${passes} passed, ${failures} failed`);
}

main()
  .catch((e) => {
    console.error('\nFATAL', e);
    failures++;
  })
  .finally(async () => {
    const n = await cleanup();
    console.log(`cleaned up ${n} scratch lead(s) under ${OWNER}`);
    process.exit(failures === 0 ? 0 : 1);
  });
