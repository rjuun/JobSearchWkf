/**
 * The single choke point for LLM calls. Forces a function (tool) call with a
 * strict JSON schema, validates with zod (+ one retry), logs tokens. `mock` mode
 * returns deterministic fixtures so the whole pipeline runs without an API key.
 *
 * Provider: DeepSeek (OpenAI-compatible). `deepseek-chat` supports function
 * calling, which our forced-tool contract relies on. We translate each ToolDef's
 * `input_schema` into an OpenAI `function.parameters` and force the call via
 * `tool_choice`. If the model answers in prose instead of a tool call (it
 * occasionally does), we fall back to extracting JSON from the message content.
 */
import type { z } from 'zod';
import { env, isLiveLlm } from '../env';
import { db } from '../db';
import { llmCalls } from '../db/schema';
import type { ToolDef } from './schemas';

export type StepModel = 'sonnet' | 'opus';

// Map the methodology's model tiers onto DeepSeek models (resolved from env so
// they can be retuned without touching call sites).
function modelId(tier: StepModel): string {
  return tier === 'opus' ? env.deepseekModelReason : env.deepseekModelChat;
}

export type RunArgs<T> = {
  step: string;
  model: StepModel;
  system: string;
  user: string;
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
  let lastErr: unknown;
  // One bounded retry: on zod failure, feed the error back and ask again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? args.user
        : `${args.user}\n\nYour previous ${args.tool.name} call failed validation: ${String(lastErr)}. Re-emit a valid ${args.tool.name} call that satisfies the schema exactly.`;
    if (attempt > 0) logLine({ step: args.step, model, mode: 'live', status: 'retry', ms: Date.now() - start, note: `attempt ${attempt + 1} — ${String(lastErr).slice(0, 160)}` });

    let raw: unknown;
    let usage: Usage;
    try {
      ({ raw, usage } = await callDeepSeek(model, args.system, user, args.tool));
    } catch (err) {
      // Transport/HTTP failure (e.g. DeepSeek 429/5xx). Record it, print it, re-throw.
      const ms = Date.now() - start;
      const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
      logLine({ step: args.step, model, mode: 'live', status: 'error', ms, note: msg });
      await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, ms, status: 'error', error: msg, attempts: attempt + 1, leadId: args.leadId, ownerId: args.ownerId });
      throw err;
    }
    inputTokens += usage.prompt_tokens ?? 0;
    outputTokens += usage.completion_tokens ?? 0;

    const parsed = args.zod.safeParse(raw);
    if (parsed.success) {
      const ms = Date.now() - start;
      logLine({ step: args.step, model, mode: 'live', status: 'ok', ms, inputTokens, outputTokens });
      await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, ms, status: 'ok', attempts: attempt + 1, leadId: args.leadId, ownerId: args.ownerId });
      return { data: parsed.data, mode: 'live', model, tokens: inputTokens + outputTokens, ms };
    }
    lastErr = parsed.error.message;
  }

  // Both attempts returned schema-invalid output. Record, print, throw.
  const ms = Date.now() - start;
  const msg = `tool output failed validation twice — ${String(lastErr).slice(0, 400)}`;
  logLine({ step: args.step, model, mode: 'live', status: 'error', ms, note: msg });
  await logCall({ step: args.step, model, mode: 'live', inputTokens, outputTokens, ms, status: 'error', error: msg, attempts: 2, leadId: args.leadId, ownerId: args.ownerId });
  throw new Error(`${args.step}: ${msg}`);
}

type Usage = { prompt_tokens?: number; completion_tokens?: number };

/** One DeepSeek chat-completion forcing the given tool; returns parsed args + usage. */
async function callDeepSeek(
  model: string,
  system: string,
  user: string,
  tool: ToolDef
): Promise<{ raw: unknown; usage: Usage }> {
  const res = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
      tool_choice: { type: 'function', function: { name: tool.name } },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    usage?: Usage;
  };
  const msg = json.choices?.[0]?.message;
  const argStr = msg?.tool_calls?.[0]?.function?.arguments;
  const raw = argStr !== undefined ? safeJson(argStr) : extractJson(msg?.content ?? '');
  return { raw, usage: json.usage ?? {} };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return extractJson(s);
  }
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
  ms: number;
  status: 'ok' | 'error';
  error?: string;
  attempts: number;
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
      latencyMs: c.ms,
      status: c.status,
      error: c.error ?? null,
      attempts: c.attempts,
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
  note?: string;
}): void {
  const tag = l.status === 'ok' ? 'ok   ' : l.status === 'error' ? 'ERROR' : 'retry';
  const step = (l.step ?? '?').padEnd(14);
  const tok =
    l.inputTokens != null || l.outputTokens != null
      ? ` in=${l.inputTokens ?? 0} out=${l.outputTokens ?? 0} (${(l.inputTokens ?? 0) + (l.outputTokens ?? 0)} tok)`
      : '';
  const note = l.note ? ` — ${l.note}` : '';
  const line = `[llm] ${tag} ${step} ${l.model}  ${l.mode}  ${l.ms}ms${tok}${note}`;
  if (l.status === 'error') console.error(line);
  else console.log(line);
}
