/**
 * M2 · Commit an approved coaching draft into the Career Graph. The target node
 * is carried on the prompt (set by the generating engine):
 *   metric  → a new quantified result on an existing story
 *   summary → an existing position's one-line scope
 *   ats     → ATS keyword variants merged into an existing skill
 *   story   → a brand-new STAR (engine 3 "tell me about a time…") + action + result
 * Everything written here is born of coaching → source='ai_coached'.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { positions, skillsMaster, starResults, stars, starActions } from './db/schema';

type TargetNode = {
  kind?: string;
  rowId?: string;
  starRef?: string | null;
  /** ats_bundle: the skills this multi-skill prompt covers. */
  skills?: { id: string; name: string }[];
};
type AnswerLike = {
  rawAnswer: string | null;
  draftAction: string | null;
  draftResult: string | null;
  metric: string | null;
  confidence: number | null;
};
type PromptLike = { targetNode: unknown };
/** The subset of the DB surface a commit/revert needs — satisfied by both `db` and a tx. */
export type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

const shortTitle = (s: string) => s.split(/\s+/).slice(0, 9).join(' ').replace(/[.,;:]+$/, '');

export function atsBundleEdits(
  rawAnswer: string | null,
  skills: { id: string; name: string }[]
): { id: string; variants: string[] }[] {
  // Longest name first so "M&A Integration" wins over a shorter "M&A".
  const known = [...skills].sort((a, b) => b.name.length - a.name.length);
  const bySkill = new Map<string, { id: string; variants: string[] }>();

  for (const rawLine of (rawAnswer ?? '').split(/\n/)) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();
    const match = known.find((s) => lower.startsWith(s.name.trim().toLowerCase()));
    if (!match) continue;
    const rest = line.slice(match.name.trim().length).replace(/^\s*[:\-–—]\s*/, '');
    const variants = rest.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!variants.length) continue;

    const bucket = bySkill.get(match.id) ?? { id: match.id, variants: [] };
    bucket.variants = Array.from(new Set([...bucket.variants, ...variants]));
    bySkill.set(match.id, bucket);
  }

  return [...bySkill.values()];
}

/**
 * How to undo an approval (M3). Create-cases delete what they made; in-place merges
 * restore the prior value. Stored on the coaching answer at approve time.
 */
export type RevertPlan =
  | { kind: 'delete-star'; starRef: string }
  | { kind: 'delete-results'; ids: string[] }
  | { kind: 'restore-summary'; positionId: string; prior: string | null; priorSource: string }
  | { kind: 'restore-variants'; skills: { id: string; prior: string[]; priorSource: string }[] };

export type CommitResult = { nodeId: string | null; revert: RevertPlan | null };

/**
 * Validate a revert plan read back from jsonb before we act on it. Reverts are written by
 * our own commit code so this is defensive (a schema drift or hand-edited row would otherwise
 * hit `undefined.length`), not a trust boundary — an unrecognized shape yields null → skip.
 */
export function asRevertPlan(x: unknown): RevertPlan | null {
  if (!x || typeof x !== 'object') return null;
  const p = x as Record<string, unknown>;
  switch (p.kind) {
    case 'delete-star':
      return typeof p.starRef === 'string' ? (p as RevertPlan) : null;
    case 'delete-results':
      return Array.isArray(p.ids) ? (p as RevertPlan) : null;
    case 'restore-summary':
      return typeof p.positionId === 'string' ? (p as RevertPlan) : null;
    case 'restore-variants':
      return Array.isArray(p.skills) ? (p as RevertPlan) : null;
    default:
      return null;
  }
}

/** Commit an approved draft into the graph. Returns the node id + how to undo it. */
export async function commitDraftToGraph(
  owner: string,
  prompt: PromptLike,
  answer: AnswerLike,
  database: DbExecutor = db
): Promise<CommitResult> {
  const tn = (prompt.targetNode ?? {}) as TargetNode;
  const action = (answer.draftAction ?? answer.rawAnswer ?? '').trim();
  const result = answer.draftResult?.trim() || null;
  const metric = answer.metric ?? null;
  const conf = answer.confidence ?? 1;
  if (!action) return { nodeId: null, revert: null };

  if (tn.kind === 'metric' && tn.starRef) {
    const [{ n }] = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(starResults)
      .where(and(eq(starResults.ownerId, owner), eq(starResults.starRef, tn.starRef)));
    const [row] = await database
      .insert(starResults)
      .values({
        ownerId: owner,
        refCode: `${tn.starRef}-R${(n ?? 0) + 1}`,
        starRef: tn.starRef,
        text: result || action,
        metric,
        source: 'ai_coached',
        confidence: conf,
      })
      .returning({ id: starResults.id });
    return { nodeId: row?.id ?? null, revert: row ? { kind: 'delete-results', ids: [row.id] } : null };
  }

  if (tn.kind === 'summary' && tn.rowId) {
    const [before] = await database
      .select({ summary: positions.summary, source: positions.source })
      .from(positions)
      .where(and(eq(positions.id, tn.rowId), eq(positions.ownerId, owner)));
    await database
      .update(positions)
      .set({ summary: action, source: 'ai_coached', updatedAt: new Date() })
      .where(and(eq(positions.id, tn.rowId), eq(positions.ownerId, owner)));
    return {
      nodeId: tn.rowId,
      revert: { kind: 'restore-summary', positionId: tn.rowId, prior: before?.summary ?? null, priorSource: before?.source ?? 'authored' },
    };
  }

  if (tn.kind === 'ats' && tn.rowId) {
    const [sk] = await database
      .select()
      .from(skillsMaster)
      .where(and(eq(skillsMaster.id, tn.rowId), eq(skillsMaster.ownerId, owner)));
    if (!sk) return { nodeId: tn.rowId, revert: null };
    const prior = sk.atsKeywordVariants ?? [];
    const variants = (answer.rawAnswer ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const merged = Array.from(new Set([...prior, ...variants]));
    await database
      .update(skillsMaster)
      .set({ atsKeywordVariants: merged, source: 'ai_coached', updatedAt: new Date() })
      .where(eq(skillsMaster.id, tn.rowId));
    return { nodeId: tn.rowId, revert: { kind: 'restore-variants', skills: [{ id: tn.rowId, prior, priorSource: sk.source }] } };
  }

  // M2 · ats_bundle — one multi-skill pass. Each line is "Skill: variant, variant".
  // Match the leading skill against the KNOWN names (longest first) rather than a generic
  // split — so hyphenated names ("Cross-functional leadership") aren't truncated — then take
  // the rest after any separator (:, -, –, —) as variants. Unmatched lines are ignored.
  if (tn.kind === 'ats_bundle' && tn.skills?.length) {
    let firstId: string | null = null;
    const reverts: { id: string; prior: string[]; priorSource: string }[] = [];
    for (const edit of atsBundleEdits(answer.rawAnswer, tn.skills)) {
      const [sk] = await database
        .select()
        .from(skillsMaster)
        .where(and(eq(skillsMaster.id, edit.id), eq(skillsMaster.ownerId, owner)));
      if (!sk) continue;
      const prior = sk.atsKeywordVariants ?? [];
      const merged = Array.from(new Set([...prior, ...edit.variants]));
      await database
        .update(skillsMaster)
        .set({ atsKeywordVariants: merged, source: 'ai_coached', updatedAt: new Date() })
        .where(eq(skillsMaster.id, edit.id));
      reverts.push({ id: edit.id, prior, priorSource: sk.source });
      firstId = firstId ?? edit.id;
    }
    return { nodeId: firstId, revert: reverts.length ? { kind: 'restore-variants', skills: reverts } : null };
  }

  // engine 3 / 'story' (default) — a brand-new STAR grown from the answer.
  const ref = `CS-${Date.now().toString(36)}`;
  const [star] = await database
    .insert(stars)
    .values({ ownerId: owner, refCode: ref, title: shortTitle(action) || 'Coached story', summary: action, source: 'ai_coached', confidence: conf })
    .returning({ id: stars.id });
  await database
    .insert(starActions)
    .values({ ownerId: owner, refCode: `${ref}-A1`, starRef: ref, text: action, source: 'ai_coached', confidence: conf });
  if (result || metric) {
    await database
      .insert(starResults)
      .values({ ownerId: owner, refCode: `${ref}-R1`, starRef: ref, text: result || action, metric, source: 'ai_coached', confidence: conf });
  }
  return { nodeId: star?.id ?? null, revert: { kind: 'delete-star', starRef: ref } };
}

/**
 * Undo a committed approval (M3) — delete what it created, or restore what it changed.
 * Takes an optional `database` executor (default `db`) so the undo path can run every revert
 * inside one transaction with its status flips — all-or-nothing, no orphaned graph nodes.
 */
export async function revertCommit(owner: string, plan: RevertPlan, database: DbExecutor = db): Promise<void> {
  switch (plan.kind) {
    case 'delete-results':
      if (plan.ids.length)
        await database.delete(starResults).where(and(eq(starResults.ownerId, owner), inArray(starResults.id, plan.ids)));
      break;
    case 'delete-star':
      // Remove the coached STAR and everything grown under it.
      await database.delete(starResults).where(and(eq(starResults.ownerId, owner), eq(starResults.starRef, plan.starRef)));
      await database.delete(starActions).where(and(eq(starActions.ownerId, owner), eq(starActions.starRef, plan.starRef)));
      await database.delete(stars).where(and(eq(stars.ownerId, owner), eq(stars.refCode, plan.starRef)));
      break;
    case 'restore-summary':
      await database
        .update(positions)
        .set({ summary: plan.prior, source: plan.priorSource, updatedAt: new Date() })
        .where(and(eq(positions.id, plan.positionId), eq(positions.ownerId, owner)));
      break;
    case 'restore-variants':
      for (const s of plan.skills)
        await database
          .update(skillsMaster)
          .set({ atsKeywordVariants: s.prior, source: s.priorSource, updatedAt: new Date() })
          .where(and(eq(skillsMaster.id, s.id), eq(skillsMaster.ownerId, owner)));
      break;
  }
}
