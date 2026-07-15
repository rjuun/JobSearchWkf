/**
 * M2 · Structure a coaching answer into a draft evidence node (the question
 * card's "AI draft → your approval" step). Mirrors the C2/C3 anti-fabrication
 * guard: a metric survives ONLY if a number is actually present in the user's
 * own words — enforced in code here, not just hoped for in the prompt.
 */
import { runStructured } from './llm/client';
import { COACH_DRAFT, type CoachDraftOut } from './llm/schemas';
import { NON_NEGOTIABLES } from './prompts';
import { extractMetric } from './coaching';

const SYSTEM = `${NON_NEGOTIABLES}

--- COACH · STRUCTURE AN ANSWER ---
You are the candidate's career coach. They answered one question about their experience in their own rough words. Turn it into a single clean evidence node: a structured action sentence and, if they described an outcome, a result.
Draw out scope, scale and quantified outcomes — but NEVER invent a number. Emit a metric only if a number is explicitly present in their answer; otherwise leave it null and set needsMetric=true when a result was described without one. Prefer their own words. Do not flatter.`;

export async function draftEvidenceFromAnswer(
  question: string,
  rawAnswer: string,
  ownerId?: string | null
): Promise<CoachDraftOut> {
  const answer = rawAnswer.trim();
  const { data } = await runStructured({
    step: 'COACH',
    model: 'sonnet', // extraction/mapping tier
    system: SYSTEM,
    user: `QUESTION:\n${question}\n\nTHEIR ANSWER:\n${answer}`,
    tool: COACH_DRAFT.tool,
    zod: COACH_DRAFT.zod,
    mock: () => mockDraft(answer),
    ownerId,
  });

  return groundDraft(data, answer);
}

/**
 * Code-enforced truthfulness (pure, unit-tested): a drafted metric must actually
 * appear in the user's words. If the model emitted one that isn't there, drop it —
 * and flag that a number is still needed, since the model believed there was a result.
 */
export function groundDraft(data: CoachDraftOut, answer: string): CoachDraftOut {
  const grounded = !!data.metric && !!extractMetric(answer);
  return {
    ...data,
    metric: grounded ? data.metric : null,
    needsMetric: grounded ? false : data.needsMetric || !!data.metric,
  };
}

/** Deterministic mock (keyless installs): extract a metric, never invent one. */
export function mockDraft(answer: string): CoachDraftOut {
  const metric = extractMetric(answer);
  return {
    action: answer || 'Described an experience',
    result: null,
    metric,
    needsMetric: !metric && answer.length > 0,
    confidence: 0.7,
  };
}
