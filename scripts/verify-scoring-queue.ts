/**
 * Acceptance verification for the Scoring Phase Redesign CI (§2.4).
 *
 * Runs against the real DB under a throwaway owner id so it can create the exact
 * lead shapes each criterion needs (clean / flagged / stale) instead of hoping
 * real data happens to contain them. Everything it creates, it deletes — see
 * cleanup() and the finally block.
 *
 * LLM_MODE is forced to mock (see ./_force-mock, which must stay the first
 * import): the criteria under test are control flow, gates and DB writes, none
 * of which depend on a real model call, and mock mode's heuristics are
 * deterministic and grounded in the JD text (lib/pipeline/screening.ts's
 * mockRoadblocks etc.), which is what lets a "clean" and a "flagged" JD be
 * constructed on purpose. The one criterion mock can't prove — B5's `notes`
 * actually reaching key_patterns — is checked separately, against a real model
 * response, by verify-key-patterns.ts.
 */
import './_force-mock';
import './_env';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, pipelineRuns, llmCalls } from '../lib/db/schema';
import { runInitialChecks, runScoring, refreshFreshness, gateStatusFor } from '../lib/pipeline/screening';
import { isOutOfPlay } from '../lib/ui';

const OWNER = '00000000-0000-0000-0000-0000000ffff1'; // throwaway, not DEMO_OWNER_ID

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

const CLEAN_JD = `We are hiring a Senior Programme Manager to lead cross-border transformation work.
You will own a portfolio of change initiatives across our European operations, working directly with
the executive team to sequence delivery and report progress. The role suits someone who has run large
programmes end to end and is comfortable holding senior stakeholders to account on commitments made.
We offer a hybrid working pattern and a collaborative, low-ego culture that values careful thinking.
Responsibilities include portfolio planning, benefits tracking, and steering committee facilitation.`;

// Trips mockRoadblocks (SAP, CFA) and mockMisalignments (on-site only).
const FLAGGED_JD = `We are hiring a Finance Transformation Lead for our Vienna headquarters.
This position is fully on-site, five days a week in the office, with no remote option available.
You will lead the SAP S/4HANA finance workstream and act as product owner for the reporting suite.
A CFA is required for this position. You will also partner with the treasury team on liquidity work.
The environment is fast-paced and always-on; we move quickly and expect the same from our leaders.`;

async function makeLead(title: string, jd: string, postedDays: number | null, extra: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(jobLeads)
    .values({ ownerId: OWNER, title, jdText: jd, status: 'captured', postedDays, ...extra })
    .returning({ id: jobLeads.id });
  return row.id;
}

async function statusOf(id: string) {
  const [l] = await db.select().from(jobLeads).where(eq(jobLeads.id, id));
  return l;
}

async function stepsRunFor(id: string): Promise<string[]> {
  const rows = await db.select({ step: pipelineRuns.step }).from(pipelineRuns).where(eq(pipelineRuns.jobLeadId, id));
  return rows.map((r) => String(r.step)).sort();
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
  await cleanup(); // in case a previous run died mid-way

  console.log('\n§2.4 · A freshly captured clean lead reaches `selected` with zero manual clicks');
  const cleanId = await makeLead('Senior Programme Manager', CLEAN_JD, 5);
  await runInitialChecks(cleanId, OWNER);
  const cleanLead = await statusOf(cleanId);
  check('clean lead auto-advanced to `selected`', cleanLead.status === 'selected', `status=${cleanLead.status}`);
  check(
    'nothing was flagged on it',
    (cleanLead.roadblocks ?? []).length === 0 && (cleanLead.misalignments ?? []).length === 0,
    `rb=${(cleanLead.roadblocks ?? []).length} mis=${(cleanLead.misalignments ?? []).length}`
  );

  console.log('\n§2.4 · A flagged lead reaches `scoring_queue` and does not disappear until triaged');
  const flaggedId = await makeLead('Finance Transformation Lead', FLAGGED_JD, 5, { city: 'Vienna' });
  await runInitialChecks(flaggedId, OWNER);
  const flaggedLead = await statusOf(flaggedId);
  check('flagged lead parked at `scoring_queue`', flaggedLead.status === 'scoring_queue', `status=${flaggedLead.status}`);
  check(
    'it carries the flags that put it there',
    (flaggedLead.roadblocks ?? []).length > 0 || (flaggedLead.misalignments ?? []).length > 0,
    `rb=${(flaggedLead.roadblocks ?? []).length} mis=${(flaggedLead.misalignments ?? []).length}`
  );
  check('it is still on the active board (not out of play) while it waits', !isOutOfPlay(flaggedLead.status));

  console.log('\n§2.4 · A lead whose B1 gate trips reaches `hold` WITHOUT B2-B4 having run');
  const staleId = await makeLead('Stale Posting — Head of Controlling', FLAGGED_JD, 90, { city: 'Vienna' });
  await runInitialChecks(staleId, OWNER);
  const staleLead = await statusOf(staleId);
  const staleSteps = await stepsRunFor(staleId);
  check('stale lead reached `hold`', staleLead.status === 'hold', `status=${staleLead.status}`);
  check('pipeline_runs contains B1 only — B2-B4 never ran', staleSteps.join(',') === 'B1', `steps=[${staleSteps.join(',')}]`);
  check(
    'and its JD would have been flagged had B3/B4 run (so the absence is the gate, not an empty JD)',
    (await stepsRunFor(flaggedId)).includes('B3'),
    'same JD text produced B3/B4 rows on the non-stale lead'
  );

  console.log('\n§2.4 · "Screen anyway" override runs B2-B4 on a held lead');
  // The gate is a short-circuit, not a dead end: the override is re-running
  // initial checks. postedDays is what held it, so clear that first — same as
  // a human confirming the posting is still live.
  await db.update(jobLeads).set({ postedDays: 10 }).where(eq(jobLeads.id, staleId));
  await runInitialChecks(staleId, OWNER);
  const staleAfter = await statusOf(staleId);
  const staleStepsAfter = await stepsRunFor(staleId);
  check('B2-B4 ran on the override', staleStepsAfter.includes('B2') && staleStepsAfter.includes('B3') && staleStepsAfter.includes('B4'), `steps=[${[...new Set(staleStepsAfter)].join(',')}]`);
  check('and it left `hold`', staleAfter.status !== 'hold', `status=${staleAfter.status}`);

  console.log('\n§2.4 · Batch of N `selected` leads runs sequentially; every lead ends at `screened` or `hold`');
  const batchIds = [cleanId];
  for (let i = 0; i < 2; i++) batchIds.push(await makeLead(`Batch lead ${i + 1}`, CLEAN_JD, 3));
  for (const id of batchIds.slice(1)) await runInitialChecks(id, OWNER);
  const windows: { start: number; end: number }[] = [];
  for (const id of batchIds) {
    const start = Date.now();
    await runScoring(id, OWNER);
    windows.push({ start, end: Date.now() });
  }
  const overlapping = windows.some((w, i) => i > 0 && w.start < windows[i - 1].end);
  check(`${batchIds.length} calls, none overlapping (each completed before the next started)`, !overlapping);
  const finals = await Promise.all(batchIds.map(statusOf));
  check(
    'every batched lead ended at `screened` or `hold`',
    finals.every((l) => l.status === 'screened' || l.status === 'hold'),
    finals.map((l) => l.status).join(', ')
  );
  check('none was left at the transient `screening` marker', !finals.some((l) => l.status === 'screening'));

  console.log('\n§2.4 · A lead left at `screening` with a stale updatedAt shows as stuck and retries cleanly');
  const stuckId = await makeLead('Interrupted mid-batch', CLEAN_JD, 4);
  await runInitialChecks(stuckId, OWNER);
  const staleWhen = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
  await db.update(jobLeads).set({ status: 'screening', updatedAt: staleWhen }).where(eq(jobLeads.id, stuckId));
  const STUCK_AFTER_MS = 2 * 60 * 1000; // mirrors ready-to-score.tsx
  const stuckRow = await statusOf(stuckId);
  check(
    'the stuck rule classifies it (status `screening`, updatedAt older than 2 min)',
    stuckRow.status === 'screening' && Date.now() - stuckRow.updatedAt.getTime() > STUCK_AFTER_MS,
    `age=${Math.round((Date.now() - stuckRow.updatedAt.getTime()) / 1000)}s`
  );
  await runScoring(stuckId, OWNER);
  const retried = await statusOf(stuckId);
  check('retrying it via runScoring completed normally', retried.status === 'screened' || retried.status === 'hold', `status=${retried.status}`);
  check('and updatedAt is fresh again, so it no longer reads as stuck', Date.now() - retried.updatedAt.getTime() < STUCK_AFTER_MS);

  console.log('\n§2.4 · `roadblocked` / `misaligned` are excluded from the board like `archived`');
  await db.update(jobLeads).set({ status: 'roadblocked' }).where(eq(jobLeads.id, flaggedId));
  const dropped = await statusOf(flaggedId);
  check('a roadblocked lead is out of play', isOutOfPlay(dropped.status));
  check('so is a misaligned one', isOutOfPlay('misaligned'));
  check('so is archived (unchanged)', isOutOfPlay('archived'));
  check('a queued lead is NOT out of play', !isOutOfPlay('scoring_queue') && !isOutOfPlay('selected'));

  console.log('\n§2.4 · key_patterns write path (mock returns notes=null, so this checks preservation)');
  const legacyId = await makeLead('Legacy import with key patterns', CLEAN_JD, 6, { keyPatterns: 'LEGACY VALUE — must survive' });
  await runInitialChecks(legacyId, OWNER);
  await runScoring(legacyId, OWNER);
  const legacy = await statusOf(legacyId);
  check(
    'a null `notes` preserves an existing key_patterns rather than wiping it',
    legacy.keyPatterns === 'LEGACY VALUE — must survive',
    `key_patterns=${JSON.stringify(legacy.keyPatterns)}`
  );

  console.log('\n· refreshFreshness never overturns a decision already taken');
  const decidedId = await makeLead('Already selected, now aged out', CLEAN_JD, 90);
  await db.update(jobLeads).set({ status: 'selected' }).where(eq(jobLeads.id, decidedId));
  await refreshFreshness(decidedId, OWNER);
  const decided = await statusOf(decidedId);
  check('a `selected` lead that aged past 60 days keeps its status', decided.status === 'selected', `status=${decided.status}`);
  check('but its freshness badge did update', decided.freshnessBand != null, `band=${decided.freshnessBand}`);
  const queuedId = await makeLead('Still in the queue, now aged out', CLEAN_JD, 90);
  await db.update(jobLeads).set({ status: 'scoring_queue' }).where(eq(jobLeads.id, queuedId));
  await refreshFreshness(queuedId, OWNER);
  check('a pre-decision `scoring_queue` lead does move to hold', (await statusOf(queuedId)).status === 'hold');

  console.log('\n· gate rule agrees with the pure function under test in vitest');
  check('gateStatusFor(0,0) === selected', gateStatusFor(0, 0) === 'selected');
  check('gateStatusFor(1,0) === scoring_queue', gateStatusFor(1, 0) === 'scoring_queue');

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
