'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { coachingAnswers, coachingPrompts, graphStrengthSnapshots } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { recordActivation } from '@/lib/activation';
import { recordActivity } from '@/lib/activity';
import { draftEvidenceFromAnswer } from '@/lib/coaching-draft';
import { commitDraftToGraph, revertCommit, asRevertPlan, type DbExecutor } from '@/lib/coaching-commit';
import { generatePrompts, maybeSpawnFollowup } from '@/lib/coaching-queue';
import { getCareerGraphFor } from '@/lib/queries';
import { strengthOf } from '@/lib/career-graph';

/**
 * Post-mutation tail shared by approve + undo: record the new strength so the meter's
 * climb (or dip) is on the history, then regenerate the coach queue. Best-effort — the
 * graph write already committed, so a transient failure here must not surface as an error
 * (the queue is idempotent and self-heals on the next regeneration).
 */
async function snapshotStrengthAndRegen(owner: string): Promise<void> {
  try {
    const graph = await getCareerGraphFor(owner);
    const s = strengthOf(graph);
    await db
      .insert(graphStrengthSnapshots)
      .values({ ownerId: owner, score: s.score, label: s.label, components: s.signals });
    await generatePrompts(owner, graph);
  } catch (err) {
    console.error('[coaching] strength snapshot / queue regen failed', err);
  }
}

/** Step 1 of the question card: structure the user's rough answer into an AI draft. */
export async function draftAnswerAction(formData: FormData) {
  const owner = await currentOwnerId();
  const promptId = String(formData.get('promptId') ?? '');
  const rawAnswer = String(formData.get('rawAnswer') ?? '').trim();
  if (!promptId || !rawAnswer) return;

  const [prompt] = await db
    .select()
    .from(coachingPrompts)
    .where(and(eq(coachingPrompts.id, promptId), eq(coachingPrompts.ownerId, owner)));
  if (!prompt) return;

  const draft = await draftEvidenceFromAnswer(prompt.question, rawAnswer, owner);

  // Keep one live draft per prompt: clear prior un-committed drafts before inserting the
  // new one, so repeated edit/draft cycles don't pile up rows (committed answers, which
  // carry a committedNodeId, are left untouched — they're the record of an approval).
  await db
    .delete(coachingAnswers)
    .where(and(eq(coachingAnswers.promptId, promptId), eq(coachingAnswers.ownerId, owner), isNull(coachingAnswers.committedNodeId)));

  await db.insert(coachingAnswers).values({
    ownerId: owner,
    promptId,
    rawAnswer,
    draftAction: draft.action,
    draftResult: draft.result ?? null,
    metric: draft.metric ?? null,
    needsMetric: draft.needsMetric,
    confidence: draft.confidence,
  });
  await db
    .update(coachingPrompts)
    .set({ status: 'drafted', updatedAt: new Date() })
    .where(eq(coachingPrompts.id, promptId));

  revalidatePath('/profile/coach');
}

/** The outcome of an approve attempt — lets the client distinguish a real approval from a
 *  double-click / stale-click no-op and show the right transient feedback. */
export type ApproveResult = { ok: true } | { ok: false; reason: 'nodraft' | 'already' | 'invalid' };

/** Step 2: approve the draft → commit to the graph (the same Keep gate as C2). */
export async function approveAnswerAction(formData: FormData): Promise<ApproveResult> {
  const owner = await currentOwnerId();
  const promptId = String(formData.get('promptId') ?? '');
  if (!promptId) return { ok: false, reason: 'invalid' };

  const result = await db.transaction(
    async (tx): Promise<{ prompt: typeof coachingPrompts.$inferSelect; answer: typeof coachingAnswers.$inferSelect } | { reason: 'nodraft' | 'already' }> => {
      const [answer] = await tx
        .select()
        .from(coachingAnswers)
        .where(and(eq(coachingAnswers.promptId, promptId), eq(coachingAnswers.ownerId, owner)))
        .orderBy(desc(coachingAnswers.createdAt));
      if (!answer) return { reason: 'nodraft' };

      // Claim the prompt before writing graph evidence. The conditional update is
      // the idempotency gate under double-submit; the loser sees zero returned rows.
      const [prompt] = await tx
        .update(coachingPrompts)
        .set({ status: 'done', updatedAt: new Date() })
        .where(
          and(
            eq(coachingPrompts.id, promptId),
            eq(coachingPrompts.ownerId, owner),
            inArray(coachingPrompts.status, ['drafted'])
          )
        )
        .returning();
      if (!prompt) return { reason: 'already' }; // a prior race winner already claimed it

      const { nodeId, revert } = await commitDraftToGraph(owner, prompt, answer, tx);

      await tx
        .update(coachingAnswers)
        .set({ committedNodeId: nodeId, decision: 'keep', revert, updatedAt: new Date() })
        .where(eq(coachingAnswers.id, answer.id));

      return { prompt, answer };
    }
  );
  if ('reason' in result) return { ok: false, reason: result.reason };

  // Post-commit tail (best-effort). The "never-done" turn: this answer may open a deeper
  // follow-up; then snapshot the new strength + regenerate the queue. Guarded so a failure
  // here can't error the request after the graph write has already committed in the tx above.
  try {
    await maybeSpawnFollowup(owner, result.prompt, result.answer);
  } catch (err) {
    console.error('[coaching] follow-up spawn failed', err);
  }
  await snapshotStrengthAndRegen(owner);
  // A coach approval is a "decision" toward the first-CV win, alongside C2 Keeps (Issue 11).
  await recordActivation(owner, 'coach_approval', {});
  await recordActivity(owner, 'coach_approved', { summary: `Answered your coach: “${result.prompt.question.slice(0, 70)}”` });

  revalidatePath('/profile/coach');
  revalidatePath('/profile');
  return { ok: true };
}

/**
 * Revert + delete every answer of a prompt (used for spawned follow-ups during undo).
 * Runs on the passed executor so it participates in the caller's transaction.
 */
async function purgePromptEvidence(owner: string, promptId: string, exec: DbExecutor = db) {
  const answers = await exec
    .select()
    .from(coachingAnswers)
    .where(and(eq(coachingAnswers.promptId, promptId), eq(coachingAnswers.ownerId, owner)));
  for (const a of answers) {
    const plan = asRevertPlan(a.revert);
    if (plan) await revertCommit(owner, plan, exec);
  }
  await exec.delete(coachingAnswers).where(and(eq(coachingAnswers.promptId, promptId), eq(coachingAnswers.ownerId, owner)));
}

/**
 * Undo the last approval of a prompt (M3) — the actionable companion to auto-advance.
 * Reverts this approval's graph edit, fully cleans up any follow-up it spawned (their
 * committed evidence + answers, not just the prompt row), returns the prompt to its
 * pre-approve (drafted) state, and re-snapshots strength so history stays consistent.
 */
export async function undoApprovalAction(formData: FormData) {
  const owner = await currentOwnerId();
  const promptId = String(formData.get('promptId') ?? '');
  if (!promptId) return;

  // The whole unwind runs in ONE transaction: child-follow-up cleanup, this approval's
  // revert, and the status flips either all land or none do. A crash or a concurrent
  // approve/undo can no longer leave orphaned stars or a half-reverted prompt.
  const didUndo = await db.transaction(async (tx) => {
    const [answer] = await tx
      .select()
      .from(coachingAnswers)
      .where(and(eq(coachingAnswers.promptId, promptId), eq(coachingAnswers.ownerId, owner)))
      .orderBy(desc(coachingAnswers.createdAt));
    if (!answer) return false;

    // Fully unwind any spawned follow-ups first (depth is capped at 1), so no committed
    // evidence or answer rows are orphaned when their prompt is deleted.
    const children = await tx
      .select({ id: coachingPrompts.id })
      .from(coachingPrompts)
      .where(and(eq(coachingPrompts.ownerId, owner), eq(coachingPrompts.spawnedBy, promptId)));
    for (const c of children) await purgePromptEvidence(owner, c.id, tx);
    await tx.delete(coachingPrompts).where(and(eq(coachingPrompts.ownerId, owner), eq(coachingPrompts.spawnedBy, promptId)));

    // Revert this approval's own commit; keep the draft so the user can re-approve/edit.
    const plan = asRevertPlan(answer.revert);
    if (plan) await revertCommit(owner, plan, tx);
    await tx
      .update(coachingAnswers)
      .set({ committedNodeId: null, decision: null, revert: null, updatedAt: new Date() })
      .where(eq(coachingAnswers.id, answer.id));
    await tx
      .update(coachingPrompts)
      .set({ status: 'drafted', updatedAt: new Date() })
      .where(and(eq(coachingPrompts.id, promptId), eq(coachingPrompts.ownerId, owner)));
    return true;
  });
  if (!didUndo) return;

  // Record the reverted strength + regenerate the queue (best-effort; mirror of approve's tail).
  await snapshotStrengthAndRegen(owner);

  revalidatePath('/profile/coach');
  revalidatePath('/profile');
}

/** Set a prompt aside — persisted, so it doesn't come back on regeneration. */
export async function skipPromptAction(formData: FormData) {
  const owner = await currentOwnerId();
  const promptId = String(formData.get('promptId') ?? '');
  if (!promptId) return;
  await db
    .update(coachingPrompts)
    .set({ status: 'skipped', updatedAt: new Date() })
    .where(and(eq(coachingPrompts.id, promptId), eq(coachingPrompts.ownerId, owner)));
  revalidatePath('/profile/coach');
}
