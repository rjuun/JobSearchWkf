/**
 * The single choke point for LLM calls. Forces a tool call with a strict JSON
 * schema, validates with zod (+ one retry), logs tokens. `mock` mode returns
 * deterministic fixtures so the whole pipeline runs without an API key.
 *
 * Provider: Anthropic Claude (Messages API). Each ToolDef maps directly onto an
 * Anthropic tool ({name, description, input_schema}) and the call is forced via
 * `tool_choice: {type:'tool'}`. Anthropic returns the tool input already parsed
 * (a JSON object, not a string); if the model answers in prose instead of a
 * tool call, we fall back to extracting JSON from the text content.
 *
 * Prompt caching: the static system prefix (and, for C2, the evidence-graph
 * user block) carries a `cache_control` breakpoint with a 1h TTL, matched to
 * Reggie's screening/tailoring cadence. Cache stats are logged per call.
 */
import type { z } from 'zod';
import { env, isLiveLlm } from '../env';
import { db } from '../db';
import { llmCalls } from '../db/schema';
import type { SystemPrompt } from '../prompts';
import type { ToolDef } from './schemas';

export type StepModel = 'sonnet' | 'opus';

// Map the methodology's model tiers onto Claude models (resolved from env so
// they can be retuned without touching call sites).
function modelId(tier: StepModel): string {
  return tier === 'opus' ? env.anthropicModelOpus : env.anthropicModelSonnet;
}

/** A user-message content block; `cache_control` marks a caching breakpoint. */
export type UserContentBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl: '1h' };
};

export type RunArgs<T> = {
  step: string;
  model: StepModel;
  system: SystemPrompt;
  user: string | UserContentBlock[];
  tool: ToolDef;
  // Input param widened so T infers as the (required) zod OUTPUT type even when
  // fields use .default() — otherwise defaulted fields infer as possibly-undefined.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zod: z.ZodType<T, z.ZodTypeDef, any>;
  mock: () => unknown;
  leadId?: string | null;
  ownerId?: string | null;
};

export type RunResult<T> = { data: T; mode: 'mock' | 'live'; model: string; tokens: number; ms: number };

export async function runStructured<T>(args: RunArgs<T>): Promise<RunResult<T>> {
  const model = modelId(args.model);
  const start = Date.now();

  if (!isLiveLlm) {
    const data = args.zod.parse(args.mock());
    const ms = Date.now() - start;
    logLine({ step: args.step, model, mode: 'mock', status: 'ok', ms });
    await logCall({ step: args.step, model: `${model} (mock)`, mode: 'mock', inputTokens: 0, outputTokens: 0, ms, status: 'ok', attempts: 1, leadId: args.leadId, ownerId: args.ownerId });
    return { data, mode: 'mock', model: `${model} (mock)`, tokens: 0, ms };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let lastErr: unknown;
  // Kept across attempts so the final failure log still reports why the LAST call
  // stopped — otherwise a truncation that failed validation twice looks identical
  // to a model that simply answered badly.
  let stopReason: string | null = null;
  // One bounded retry: on zod failure, feed the error back and ask again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? args.user
        : withSuffix(args.user, `\n\nYour previous ${args.tool.name} call failed validation: ${String(lastErr)}. Re-emit a valid ${args.tool.name} call that satisfies the schema exactly.`);
    if (attempt > 0) logLine({ step: args.step, model, mode: 'live', status: 'retry', ms: Date.now() - start, note: `attempt ${attempt + 1} — ${String(lastErr).slice(0, 160)}` });

    let raw: unknown;
    let usage: Usage;
    try {
      ({ raw, usage, stopReason } = await callClaude(model, args.system, user, args.tool));
    } catch (err) {
      // Transport/HTTP failure (e.g. Anthropic 429/529/5xx). Record it, print it, re-throw.
      const ms = Date.now() - start;
      const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
      logLine({ step: args.step, model, mode: 'live', status: 'error', ms, note: msg });
      await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, ms, status: 'error', error: msg, attempts: attempt + 1, stopReason, leadId: args.leadId, ownerId: args.ownerId });
      throw err;
    }
    inputTokens += usage.input_tokens ?? 0;
    outputTokens += usage.output_tokens ?? 0;
    cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    cacheReadTokens += usage.cache_read_input_tokens ?? 0;

    const parsed = args.zod.safeParse(raw);
    if (parsed.success) {
      const ms = Date.now() - start;
      // A `max_tokens` stop means the tool JSON was cut off mid-emit. zod still
      // "succeeds" on the fragment whenever the schema defaults a missing array to
      // [], so a truncated call is indistinguishable from an empty one by its parse
      // result alone — this line and the persisted stop_reason are the only place
      // that difference survives. Not raised to an error here on purpose: the
      // client's job is to report faithfully, and only the caller knows whether an
      // empty result is a legitimate answer for its step.
      const note =
        stopReason === 'max_tokens'
          ? `TRUNCATED — stop_reason=max_tokens, tool JSON cut off at the ${outputTokens}-token ceiling; raw=${preview(raw)}`
          : undefined;
      logLine({ step: args.step, model, mode: 'live', status: 'ok', ms, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, note });
      await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, ms, status: 'ok', attempts: attempt + 1, stopReason, leadId: args.leadId, ownerId: args.ownerId });
      return { data: parsed.data, mode: 'live', model, tokens: inputTokens + outputTokens, ms };
    }
    lastErr = parsed.error.message;
  }

  // Both attempts returned schema-invalid output. Record, print, throw.
  const ms = Date.now() - start;
  const msg =
    `tool output failed validation twice${stopReason ? ` (last stop_reason=${stopReason})` : ''} — ` +
    String(lastErr).slice(0, 400);
  logLine({ step: args.step, model, mode: 'live', status: 'error', ms, note: msg });
  await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, ms, status: 'error', error: msg, attempts: 2, stopReason, leadId: args.leadId, ownerId: args.ownerId });
  throw new Error(`${args.step}: ${msg}`);
}

/** Bounded, log-safe rendering of a tool input for diagnosis. */
function preview(raw: unknown): string {
  try {
    const s = JSON.stringify(raw);
    return s === undefined ? String(raw) : s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return String(raw);
  }
}

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** Append retry feedback after the user content — after any cache breakpoint,
 *  so a retry still reads the same cached prefix. */
function withSuffix(user: string | UserContentBlock[], suffix: string): string | UserContentBlock[] {
  return typeof user === 'string' ? `${user}${suffix}` : [...user, { type: 'text', text: suffix }];
}

/** One Anthropic Messages call forcing the given tool; returns tool input + usage. */
async function callClaude(
  model: string,
  system: SystemPrompt,
  user: string | UserContentBlock[],
  tool: ToolDef
): Promise<{ raw: unknown; usage: Usage; stopReason: string | null }> {
  const res = await fetch(`${env.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      // 8000 was the original value and is low for a non-streaming call — a full
      // B2 extraction runs ~3200 output tokens, and one Vestas run hit the ceiling
      // dead-on and returned a truncated (silently empty) tool call. 16000 matches
      // Anthropic's guidance for non-streaming requests while staying well under
      // the SDK HTTP timeout.
      max_tokens: 16000,
      // The static prefix (guardrails + step note) is byte-identical across
      // leads/runs → cache it for 1h. The CI guidance grows over time → never
      // cached, so a new tip only invalidates itself, not the prefix.
      system: [
        { type: 'text', text: system.cacheable, cache_control: { type: 'ephemeral', ttl: '1h' } },
        ...(system.dynamic ? [{ type: 'text', text: system.dynamic }] : []),
      ],
      messages: [{ role: 'user', content: user }],
      // strict: grammar-constrained sampling — the tool input is guaranteed to
      // match input_schema, so the zod retry only ever fires on semantic misses.
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema, strict: tool.strict }],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string; input?: unknown }>;
    usage?: Usage;
    stop_reason?: string | null;
  };
  // Anthropic returns the tool input already parsed (an object, not a string).
  const toolUse = json.content?.find((b) => b.type === 'tool_use');
  const raw =
    toolUse !== undefined
      ? toolUse.input
      : extractJson((json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'));
  // `stop_reason` is the difference between "the model answered with nothing" and
  // "the model was cut off mid-answer". Both arrive here as a thin/empty object, so
  // the response body is the only place that distinction still exists — carry it out
  // rather than discarding it with the rest of the envelope.
  return { raw, usage: json.usage ?? {}, stopReason: json.stop_reason ?? null };
}

/** Best-effort JSON recovery when the model answers in prose / fenced code. */
function extractJson(s: string): unknown {
  if (!s) return undefined;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

type CallLog = {
  step: string;
  model: string;
  mode: 'mock' | 'live';
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  ms: number;
  status: 'ok' | 'error';
  error?: string;
  attempts: number;
  stopReason?: string | null;
  leadId?: string | null;
  ownerId?: string | null;
};

async function logCall(c: CallLog): Promise<void> {
  // Never let the audit write mask the real result: a logging failure must not
  // turn a successful (or already-failing) call into a different error.
  try {
    await db.insert(llmCalls).values({
      ownerId: c.ownerId ?? undefined,
      step: c.step,
      model: c.model,
      mode: c.mode,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheCreationTokens: c.cacheCreationTokens ?? null,
      cacheReadTokens: c.cacheReadTokens ?? null,
      latencyMs: c.ms,
      status: c.status,
      error: c.error ?? null,
      attempts: c.attempts,
      stopReason: c.stopReason ?? null,
      jobLeadId: c.leadId ?? null,
    });
  } catch (err) {
    console.error(`[llm] audit-write failed for ${c.step}: ${String(err instanceof Error ? err.message : err)}`);
  }
}

/**
 * One structured, greppable stdout line per call — the terminal observability
 * surface. Grep `[llm]` while `npm run dev` runs to watch every API call, its
 * token cost, latency, retries, and failures as they happen.
 */
function logLine(l: {
  step: string;
  model: string;
  mode: 'mock' | 'live';
  status: 'ok' | 'error' | 'retry';
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  note?: string;
}): void {
  const tag = l.status === 'ok' ? 'ok   ' : l.status === 'error' ? 'ERROR' : 'retry';
  const step = (l.step ?? '?').padEnd(14);
  const tok =
    l.inputTokens != null || l.outputTokens != null
      ? ` in=${l.inputTokens ?? 0} out=${l.outputTokens ?? 0} (${(l.inputTokens ?? 0) + (l.outputTokens ?? 0)} tok)`
      : '';
  const cache =
    (l.cacheCreationTokens ?? 0) > 0 || (l.cacheReadTokens ?? 0) > 0
      ? ` cache[w=${l.cacheCreationTokens ?? 0} r=${l.cacheReadTokens ?? 0}]`
      : '';
  const note = l.note ? ` — ${l.note}` : '';
  const line = `[llm] ${tag} ${step} ${l.model}  ${l.mode}  ${l.ms}ms${tok}${cache}${note}`;
  if (l.status === 'error') console.error(line);
  else console.log(line);
}
