---
ci-area: Infrastructure / LLM
ci-roadmap:
ci-title: Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single Provider)
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-07-24
ci-estimated-time: 10
ci-time-spent: 2
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Development","startTime":"2026-07-24T15:23:48.000Z","endTime":"2026-07-24T17:27:39.044Z"}]}
```
---

## 1. What is the problem or opportunity?

RoleProof was built pointing every LLM step at DeepSeek (`lib/llm/client.ts`) to keep costs near
zero during design. Now that the app is going live and will process real job leads that gate real
decisions, sensitive steps need to run on a provider whose judgment Reggie actually trusts — Claude.

Two things surfaced during cost/architecture analysis (2026-07-24 session) that this CI resolves:

1. **Spec/code mismatch on the model gates.** `Job_Hunting_Master_Instructions.md` §6.1 assigns
   **C2 (evidence mapping), C3 (bullet drafting), and C5 (profile draft) to Opus 4.8** — the note
   calls them "truthfulness-critical" and "the CV substance." But `lib/pipeline/tailoring.ts`
   currently calls all three with `model: 'sonnet'`. This has been invisible because both tiers
   resolve to the same `deepseek-chat` model today (`lib/env.ts`) — it will not be invisible once
   the tiers point at two different real models. **This must be fixed in the same change**, not
   left as a follow-up.
2. **Grok was considered and rejected.** Modeled per-lead cost (Capture → C7, one lead) on
   Claude-only is **≈$0.27 (~€0.24)**, of which Opus-tier steps already account for ~82%. Routing
   the cheapest, least-sensitive steps (B2/B4/B5) to Grok only saves ~$0.03/lead (~9–12%) because
   the steps that are actually candidates for a cheaper model are already the cheap ones — the
   expensive steps (B6, C2, C3, C5, C7) are exactly the truthfulness-critical ones a cheaper model
   shouldn't touch. That saving doesn't justify a second provider (second API key, second
   tool-calling quirk set, larger test matrix) at RoleProof's current lead volume (~140 leads
   total to date). **Decision: single provider (Claude), no Grok.**

A bigger, provider-native cost lever than Grok ever would have been: the system prompt for every
step (`NON_NEGOTIABLES` + the step's `Process/*.md` note, built in `lib/prompts.ts`) is
byte-identical across every lead and every run of that step. Claude's prompt caching cuts the
cost of that unchanged prefix by 90% on a cache hit. This CI implements that alongside the
provider switch since it touches the same code path.

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- Replace DeepSeek with Anthropic Claude across all 9 LLM-calling steps: B2, B3, B4, B5, B6, C2,
  C3, C5, C7.
- Fix the C2/C3/C5 tier mismatch (`sonnet` → `opus`, matching Master Instructions §6.1).
- Add prompt caching (1-hour TTL, uniformly) on the static system-prompt content, and on C2's
  evidence-graph block specifically.
- Update env/config, docs, and (optionally) `llm_calls` logging to capture cache stats.

**Out of scope (do not implement in this pass):**
- xAI/Grok integration — explicitly rejected above. Do not add a Grok client.
- The proposed "Scoring Queue" workflow redesign (auto-run B2/B3 at ingest; batch-run B4–B6 after
  a Roadblocked/Misaligned/Selected human gate). That's a separate, larger CI — this migration
  should not block on it, though the routing/caching work here is compatible with it either way.
- Any database/infra migration (Supabase vs. NAS Postgres) — tracked in its own CI
  (`RoleProof as Stand-alone App…`).

### 2.1 Current state (for reference — don't rediscover this)

- Single choke point: `lib/llm/client.ts` → `runStructured({step, model, system, user, tool, zod, mock})`.
- `callDeepSeek()`: OpenAI-compatible `fetch` to `${env.deepseekBaseUrl}/chat/completions`, forces
  a tool call via `tool_choice: {type:"function", function:{name}}`, parses
  `message.tool_calls[0].function.arguments` (a JSON **string**), falls back to prose-JSON
  extraction if the model doesn't call the tool.
- `StepModel = 'sonnet' | 'opus'` → `modelId()` resolves to `env.deepseekModelChat` /
  `env.deepseekModelReason` — **both default to `'deepseek-chat'` today**, which is why the C2/C3/C5
  bug has had no visible effect yet.
- Call sites and their current (buggy) tiers:
  - `lib/pipeline/screening.ts`: B2 `sonnet`, B3 `sonnet`, B4 `sonnet`, B5 `sonnet`, B6 `opus` ✓ correct
  - `lib/pipeline/tailoring.ts`: C2 `sonnet` ✗ should be `opus`, C3 `sonnet` ✗ should be `opus`,
    C5 `sonnet` ✗ should be `opus`, C7 `opus` ✓ correct
- `lib/prompts.ts` → `systemPromptFor(step, ownerId)` returns **one concatenated string**:
  `NON_NEGOTIABLES + "\n\n--- STEP PROCEDURE ---\n" + stepNote + ciGuidance`. `ciGuidance` (from
  `lib/ci.ts`) can grow over time as Accuracy Improvement Tips accrue for that owner/step — it is
  the only part of the system prompt that isn't fully static.
- `lib/pipeline/tailoring.ts` → `gatherEvidence(ownerId)` (used only by C2) pulls the owner's
  **entire** evidence graph (STAR actions ~37, responsibilities ~22, bullet bank ~23, education,
  languages — see `docs/DATA_MODEL.md`) and inlines it into the per-lead user message. This content
  does not depend on `leadId` — it's identical for every lead tailored by the same owner in the
  same sitting, but today it's re-sent (and re-billed) on every single C2 call.
- `lib/env.ts`: `deepseekApiKey`, `deepseekBaseUrl`, `deepseekModelChat`, `deepseekModelReason`;
  `isLiveLlm = llmMode === 'live' && deepseekApiKey !== ''`.

### 2.2 Target state

**A. New Claude client function in `lib/llm/client.ts`**

Add `callClaude(model, system, user, tool)` alongside (replacing) `callDeepSeek`:
- `POST https://api.anthropic.com/v1/messages` (or `env.anthropicBaseUrl`), header
  `x-api-key: env.anthropicApiKey`, `anthropic-version: 2023-06-01` (confirmed live 2026-07-24
  against both `claude-sonnet-5` and `claude-opus-4-8` with the real key — see §4).
- Body: `{ model, max_tokens: 8000, system: <array, see below>, messages: [{role:'user', content: user}], tools: [{name, description, input_schema}], tool_choice: {type:'tool', name: tool.name} }`.
- Anthropic returns tool input **already parsed** (a `tool_use` content block's `input` field is a
  JSON object, not a string) — simpler than DeepSeek's `JSON.parse(arguments)` path, but the
  extraction code differs. Find the `content` block where `type === 'tool_use'`; use its `.input`
  directly as `raw`. Keep a prose-fallback path only if no `tool_use` block is present (mirrors
  today's `extractJson` fallback).
- Usage: read `usage.input_tokens`, `usage.output_tokens`, and (new) `usage.cache_creation_input_tokens`,
  `usage.cache_read_input_tokens`. Return all four from `callClaude` so `runStructured` can log them.
- Delete `callDeepSeek` and the DeepSeek-specific parsing helpers once `callClaude` is verified
  working end-to-end (single-provider decision — no dual-path fallback to maintain).

**B. Per-step model IDs**

Replace `deepseekModelChat` / `deepseekModelReason` with:
```
anthropicModelSonnet: str('ANTHROPIC_MODEL_SONNET', 'claude-sonnet-5')
anthropicModelOpus:   str('ANTHROPIC_MODEL_OPUS', 'claude-opus-4-8')
```
`modelId(tier)` now resolves `'sonnet' → anthropicModelSonnet`, `'opus' → anthropicModelOpus`.

**C. Fix the gate mismatch**

In `lib/pipeline/tailoring.ts`, change the `model:` argument on the C2, C3, and C5
`runStructured(...)` calls from `'sonnet'` to `'opus'`. Three one-line changes. Verify against
Master Instructions §6.1 that no other step needs correcting (B2–B5, C1/C4/C6-code, C7 already
match).

**D. System-prompt caching**

`systemPromptFor()` in `lib/prompts.ts` should stop returning one flat string. Return:
```ts
type SystemPrompt = { cacheable: string; dynamic: string };
// cacheable = NON_NEGOTIABLES + the step's Process/*.md note (stable until the .md is edited)
// dynamic   = ciGuidance (grows as Accuracy Improvement Tips accrue — never cache this)
```
`RunArgs.system` changes from `string` to `SystemPrompt`. In `callClaude`, build:
```ts
system: [
  { type: 'text', text: args.system.cacheable, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ...(args.system.dynamic ? [{ type: 'text', text: args.system.dynamic }] : []),
]
```
Note: `cache_control` on a prose-JSON mock/DeepSeek path is meaningless — only wire this into
`callClaude`. Mock mode (`isLiveLlm === false`) is untouched; it never calls a provider.

**E. Evidence-graph caching (C2 only, the single highest-value cache target)**

In `runEvidenceMapping` (`lib/pipeline/tailoring.ts`), the `user` string currently interleaves
role, requirements, the full evidence graph, and CV slot labels in one block. Split it so the
evidence-graph text (owner-wide, lead-independent) is its own cacheable block, with the per-lead
role/requirements as the varying suffix that comes after it:
```ts
const evidenceBlock = evidence.map(e => `[${e.ref}] (${e.kind}) ${e.text}`).join('\n');
const user = [
  { type: 'text', text: `CANDIDATE EVIDENCE (cite by exact ref code):\n${evidenceBlock}`, cache_control: { type: 'ephemeral', ttl: '1h' } },
  { type: 'text', text: `ROLE: ...\n\nREQUIREMENTS: ...\n\nCV POSITION SLOTS: ...` },
];
```
This requires `runStructured`'s `user` param to accept either a string or a content-block array —
widen the type; every other call site keeps passing a plain string. Cache breakpoint order
(tools → system → messages) and the 4-breakpoint limit are respected: this uses 2 of 4 (one on
the system block, one here).

**F. TTL: uniform 1-hour, not the 5-minute default, everywhere**

Reggie's actual cadence: screening runs across 8–12 leads over 1–1.5h (≈5–11 min between leads);
tailoring runs ~1h per lead, 2–3 leads in a sitting, so consecutive C2/C3/C5/C7 calls across leads
are spaced close to an hour apart. The 5-minute default would miss almost every one of those gaps.
Use `ttl: '1h'` on every `cache_control` block in this implementation — don't mix TTLs per step,
it adds an ordering constraint for no real benefit at this cost scale. Expect B2/B3 (which may
later run at ingest time, scattered through the day) to have a lower/unpredictable hit rate than
the batch-run steps — that's fine, don't special-case it.

**G. `llm_calls` logging (optional but recommended)**

Add two nullable integer columns via `drizzle-kit generate` (don't hand-write SQL — follow the
existing `drizzle/000N_*.sql` pattern): `cache_creation_tokens`, `cache_read_tokens` on
`llm_calls`. Populate from `callClaude`'s returned usage. This gives Reggie real hit-rate data
after the first few live sessions instead of relying on this document's modeled estimates.

**H. Env / config**

`lib/env.ts`: add `anthropicApiKey`, `anthropicBaseUrl` (default `https://api.anthropic.com`),
`anthropicModelSonnet`, `anthropicModelOpus`. Update `isLiveLlm` to check `anthropicApiKey !== ''`
instead of `deepseekApiKey`. Remove the `deepseek*` fields once `callDeepSeek` is deleted (step A).
Update `.env.example` to match (remove DeepSeek block, add Anthropic block with the same comment
style already used there). **Do not commit a real API key** — same convention as the existing
`.env.local` (gitignored).

**I. Docs**

- `docs/PIPELINE.md`: the flow diagram and step table currently label every LLM step "*DeepSeek*"
  — update to the correct model per step (`Sonnet 5` / `Opus 4.8`), and correct C2/C3/C5.
- `docs/ARCHITECTURE.md`: "How a pipeline step calls the LLM (DeepSeek)" section — update provider
  name, and the code-block diagram that ends in "DeepSeek API."
- `Job_Hunting_Master_Instructions.md` §6.1 — this file lives on OneDrive (fetched via the M365
  connector in chat sessions), **not** in this repo, so Claude Code cannot edit it directly. Flag
  this as a manual follow-up for Reggie: once the code matches the table, the table itself needs
  no edit (it was already correct — the code was wrong), but the "Claude must check the model
  against the table... and pause if there is a mismatch" instruction can now be satisfied for real.

### 2.3 Ordered implementation checklist

1. Add Anthropic env vars to `lib/env.ts` and `.env.example`; obtain and set a real
   `ANTHROPIC_API_KEY` in `.env.local` (not committed).
2. Implement `callClaude()` in `lib/llm/client.ts`; wire `modelId()` to the new Anthropic model
   env vars; widen `RunArgs.system` to `SystemPrompt` and `RunArgs.user` to `string | ContentBlock[]`.
3. Update `runStructured()` to call `callClaude` instead of `callDeepSeek`; adapt usage/logging to
   the four Anthropic usage fields; remove `callDeepSeek` and its now-unused helpers.
4. Update `lib/prompts.ts`'s `systemPromptFor()` to return `{cacheable, dynamic}`.
5. Update all 9 call sites (`screening.ts` ×5, `tailoring.ts` ×4) to pass the new `system` shape —
   this is where the C2/C3/C5 `model: 'opus'` fix also lands.
6. Restructure C2's `user` construction in `tailoring.ts` per §2.2.E (evidence block as its own
   cached content block).
7. Add the `cache_creation_tokens` / `cache_read_tokens` migration (`drizzle-kit generate`, then
   `scripts/migrate.ts`) and thread the values through `logCall()`.
8. Run the existing `lib/__tests__` suite (`vitest`) — should pass unchanged since mock mode
   doesn't touch any of the above.
9. Live smoke test: one real lead, full A1 → C7, `LLM_MODE=live`. Confirm via the `[llm]` stdout
   lines that every step logs `claude-sonnet-5` or `claude-opus-4-8` (not `deepseek-chat`), that
   C2/C3/C5 log `opus`, and that a second call to the same step within the hour shows a nonzero
   `cache_read_input_tokens` in the Anthropic response.
10. Update `docs/PIPELINE.md` and `docs/ARCHITECTURE.md` per §2.2.I.
11. Manually flag to Reggie: no edit needed to `Job_Hunting_Master_Instructions.md` (the table was
    already right), but worth a note in its Notes/changelog that the code now matches it.

### 2.4 Acceptance criteria

- All 9 LLM steps run live against Claude; zero references to `deepseek` remain in `lib/llm/client.ts` or `lib/env.ts`.
- C2, C3, C5 log model tier `opus`; B2–B5 log `sonnet`; B6/C7 log `opus` (unchanged).
- A same-step, same-owner call made a second time within an hour shows a cache hit
  (`cache_read_input_tokens > 0`) in the raw Anthropic response.
- `vitest` suite passes unchanged.
- One full live lead (A1→C7) completes without errors and produces a `.docx` + ATS rating.
- `.env.example` updated; no secrets committed; `docs/PIPELINE.md` and `docs/ARCHITECTURE.md` no
  longer say "DeepSeek."

### 2.5 Explicitly rejected alternative (audit trail)

xAI Grok as a second provider for B2/B4/B5 (the least-sensitive, mechanical steps): modeled at
~$0.03/lead savings (~9–12% of an already-small ~$0.27/lead baseline), against the cost of a
second API integration, second vendor relationship, and a larger test matrix. Not worth it at
RoleProof's current volume. Revisit only if lead volume grows by an order of magnitude or if
Anthropic pricing/quality shifts materially.

## 3. Resources or references

- Code: `lib/llm/client.ts`, `lib/prompts.ts`, `lib/pipeline/screening.ts`,
  `lib/pipeline/tailoring.ts`, `lib/env.ts`, `.env.example`, `drizzle/` (new migration).
- Docs to update: `docs/ARCHITECTURE.md`, `docs/PIPELINE.md`.
- Spec of record: `Job_Hunting_Master_Instructions.md` §6.1 (Model-Specific Guidance table) —
  source of the C2/C3/C5 Opus assignment.
- Anthropic API: Messages API + tool use (`platform.claude.com/docs`), pricing
  (`platform.claude.com/docs/en/about-claude/pricing` — Sonnet 5 $2/$10 per MTok through
  2026-08-31, then $3/$15; Opus 4.8 $5/$25 per MTok), prompt caching
  (`platform.claude.com/docs/en/build-with-claude/prompt-caching` — 1,024-token minimum cacheable
  block for both Sonnet 5 and Opus 4.8; 1h TTL = 2× write price, 0.1× read price).
- This CI was opened following a same-day chat session that modeled baseline/mixed-provider costs,
  worked through prompt-caching mechanics, and tuned TTL against Reggie's actual usage cadence
  (8–12 leads/screening sitting, 2–3 leads/tailoring sitting) — see that conversation for the full
  cost derivation if the numbers above need re-checking.

## 4. Notes / Progress log

- 2026-07-24: CI opened. Decision made: single-provider Claude (Sonnet 5 + Opus 4.8), no Grok.
  Spec written to be handed directly to a Claude Code session against this repo. Not yet executed.
- 2026-07-24 (Claude Code session): **Implemented.** All spec items landed:
  - `callClaude()` replaces `callDeepSeek()` in `lib/llm/client.ts` (Messages API, forced
    `tool_choice: {type:'tool'}`, prose-JSON fallback kept); `callDeepSeek`/`safeJson` deleted.
  - Env: `anthropic*` vars added, `deepseek*` removed, `isLiveLlm` now keys off `ANTHROPIC_API_KEY`;
    `.env.example` updated.
  - C2/C3/C5 tier mismatch fixed → `opus` (B2–B5 sonnet, B6/C7 opus unchanged, verified vs §6.1).
  - `systemPromptFor()` returns `{cacheable, dynamic}`; static prefix cached with 1h TTL; CI
    guidance stays uncached. C2's evidence graph is its own cached user block (2 of 4 breakpoints).
  - Beyond the spec's 9 call sites, four more `runStructured` callers were migrated to the new
    `system` shape: A1 capture (its static procedure now also cached), O2 onboarding extract,
    STORY, and COACH — all stay on the sonnet tier.
  - `llm_calls` gained nullable `cache_creation_tokens` / `cache_read_tokens`
    (`drizzle/0021_unusual_gideon.sql`, applied); `[llm]` stdout lines now print `cache[w=… r=…]`.
  - Docs: `docs/PIPELINE.md` + `docs/ARCHITECTURE.md` updated (also corrected C1/C4 to "code" —
    they never were LLM steps).
  - **Live smoke test** (2× B2 sonnet, 2× C7 opus via `runStructured`): models log
    `claude-sonnet-5` / `claude-opus-4-8`; warm calls hit the cache (B2: `r=6946, w=0`;
    C7: `r=1872, w=0`) — both prefixes cache fine at their actual sizes. `tsc --noEmit` clean.
  - **Open items:** (1) Full A1→C7 live run on a real lead still to be done by Reggie via the UI —
    it can't be automated end-to-end because the C2 Keep/Maybe/Drop human gate sits in the middle.
    (2) `vitest` could not run on this machine: pre-existing environment issue (Node v20.11.1
    lacks `util.styleText`, which vitest 4 requires at startup — fails identically before this
    change; upgrade Node ≥20.12 to re-enable the suite). (3) Observation: B2 on Sonnet 5 hit the
    bounded zod retry on both live calls (`roadblocks` first emitted as a string) — works, but
    doubles B2 cost/latency; tighten the B2 tool schema as a small follow-up.
    (4) Manual note for `Job_Hunting_Master_Instructions.md` (OneDrive): no table edit needed —
    the code now matches §6.1; worth a changelog line there.
- 2026-07-24: `ANTHROPIC_API_KEY` created and added to `.env.local` (old `DEEPSEEK_*` vars left in
  place, unused, for reference). Verified live from PowerShell with `Invoke-RestMethod` against
  `https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`: both `claude-sonnet-5`
  and `claude-opus-4-8` returned `stop_reason: end_turn` with real content — key and model access
  both confirmed working before implementation started.
- 2026-07-24: Claude Code (running on Fable 5) implemented and live-smoke-tested the full CI.
  `tsc --noEmit` clean; cache hits confirmed (B2 read 6,946 tokens; C7 read 1,872). Two things
  unverified for pre-existing, unrelated reasons: `vitest` won't start (Node 20.11.1 predates an
  API vitest 4 needs — upgrade to ≥20.12 to unblock, do this before the manual A1→C7 run so the
  suite covers the migrated code); `next lint` has a pre-existing plugin-resolution error, lower
  priority, own backlog item.
- 2026-07-24 (follow-up, root-caused after reading the shipped code): B2 hit the bounded retry on
  both live calls in the smoke test (wrong-shaped first attempt, corrects on retry — harmless but
  doubles that step's cost/latency). Two concrete causes found in `lib/llm/client.ts` /
  `lib/llm/schemas.ts`, both fixable in one pass across all 13 `ToolDef`s (not just B2):
  1. `callClaude()` never sets `temperature` — the original DeepSeek call explicitly used
     `temperature: 0`; this was dropped in the migration. Restore it.
  2. None of the `ToolDef`s set `strict: true` / `additionalProperties: false`. Anthropic's
     [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
     guarantees schema-conformant `tool_use.input` via grammar-constrained sampling — the correct
     fix for this class of problem, not a schema-wording tweak. Add `strict: true` to every
     `ToolDef` in `lib/llm/schemas.ts` and `additionalProperties: false` to each object-typed
     schema (required for strict mode). This closes the retry risk for all 13 schemas at once,
     not just B2 — supersedes the narrower "tighten B2's schema" task Claude Code suggested.
- 2026-07-24 (Claude Code session, follow-up executed): **Item 2 applied; item 1 rejected with
  live evidence.**
  - **`temperature: 0` cannot be restored** — it was not "dropped by mistake": Sonnet 5 and
    Opus 4.8 removed the sampling parameters entirely. Verified live against both models:
    `HTTP 400 — "\`temperature\` is deprecated for this model"` (request IDs
    `req_011CdMFvGUn9YuUf3nPN1sbw` / `req_011CdMFvJV5erdGVYMZ2nNyA`). The DeepSeek-era
    determinism lever no longer exists on this provider; strict tool use (item 2) is what
    actually removes output-shape variance.
  - **Strict tool use is live on all 13 `ToolDef`s**: `strict: true` (typed as literal `true`
    on `ToolDef`, so a def can't compile without it), `additionalProperties: false` on all 31
    object nodes, and `callClaude` passes `strict` through. Numeric `minimum`/`maximum` are
    unsupported in strict schemas, so B4's 1–3 rating became `enum: [1,2,3]` and C7/COACH
    ranges moved to descriptions — zod still enforces all ranges at runtime.
  - **Strict surfaced a real limit on IMPORT (O2)**: 32 optional parameters vs Anthropic's
    24-optional cap for grammar compilation (live 400). Fixed by requiring the always-emittable
    fields (top-level arrays, `confidence`) while keeping truly sometimes-absent facts
    (`metric`, dates, `proficiency`…) optional — the anti-fabrication "omit rather than invent"
    rule is preserved.
  - **Verified live** (B2 ×2, B4, C7, COACH, O2-extract): every call now validates on the
    first attempt — the B2 retry is gone — and cache reads persist (B2 r=3493, B4 r=5328,
    C7 r=1888). Node upgraded to v24: `vitest` runs again — **122/122 tests pass**;
    `tsc --noEmit` clean. Remaining before closing this CI: the manual full A1→C7 live lead
    run (§2.3 step 9) and the Master Instructions changelog line.
