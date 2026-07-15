/** Shared pipeline run primitives used by both screening (B) and tailoring (C). */
import { db } from '../db';
import { pipelineRuns } from '../db/schema';

export type StepReport = {
  step: string;
  label: string;
  status: 'done' | 'skipped' | 'error';
  model: string;
  ms: number;
  summary: string;
};

export async function recordRun(
  leadId: string,
  step: string,
  model: string,
  output: unknown,
  ms: number,
  ownerId?: string | null
) {
  await db.insert(pipelineRuns).values({
    ownerId: ownerId ?? undefined,
    jobLeadId: leadId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step: step as any,
    status: 'done',
    model,
    output: output as object,
    finishedAt: new Date(),
  });
}

/** Persist a run and return its StepReport in one call (used by the C-steps). */
export async function recordStep(
  leadId: string,
  r: { step: string; label: string; model: string; summary: string; output?: unknown; ms: number },
  ownerId?: string | null
): Promise<StepReport> {
  await recordRun(leadId, r.step, r.model, r.output ?? {}, r.ms, ownerId);
  return { step: r.step, label: r.label, status: 'done', model: r.model, ms: r.ms, summary: r.summary };
}
