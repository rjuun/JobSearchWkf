/**
 * Centralised, typed environment access. Server-side only — never import from
 * a Client Component (it reads process.env and is used by the Postgres/LLM
 * modules). Also imported by the tsx seed/migrate scripts, so it must stay free
 * of the `server-only` guard. Defaults keep local dev runnable out of the box
 * (local Postgres; LLM defaults to "live" but only actually goes live when a
 * DEEPSEEK_API_KEY is present — keyless checkouts still fall back to mock).
 */
function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

export const env = {
  databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/jobsearch_camunda'),
  // Direct (non-pooled) connection, used by CLI scripts (migrate/seed/reset) that
  // need prepared statements and session features pgbouncer's transaction pooler
  // rejects. Unset in the Vercel app runtime, which uses the pooled DATABASE_URL.
  directUrl: str('DIRECT_URL', ''),

  appEmail: str('APP_EMAIL', 'demo@local'),
  appPassword: str('APP_PASSWORD', 'demo'),
  sessionSecret: str('SESSION_SECRET', 'dev-insecure-secret-change-me-please-0123456789abcdef'),

  // Default "live": with a key present the pipeline uses real LLM judgment; with
  // no key, isLiveLlm below is still false so it safely falls back to mock.
  llmMode: str('LLM_MODE', 'live') as 'mock' | 'live',

  // DeepSeek (OpenAI-compatible) is the active LLM provider. The single client
  // wrapper in lib/llm/client.ts talks to this; mock mode needs no key.
  deepseekApiKey: str('DEEPSEEK_API_KEY', ''),
  deepseekBaseUrl: str('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  // deepseek-chat (V3) supports function calling, which our forced-tool contract
  // relies on. Both step tiers map here unless overridden.
  deepseekModelChat: str('DEEPSEEK_MODEL', 'deepseek-chat'),
  deepseekModelReason: str('DEEPSEEK_MODEL_REASON', 'deepseek-chat'),

  storageDir: str('STORAGE_DIR', '.storage'),

  // The MOCK/LIVE header pill is developer chrome — it tells *you* whether the
  // pipeline is running real LLM judgment or fixtures. Off by default so a clean
  // demo never shows it; set SHOW_LLM_PILL=1 in dev to bring it back.
  showLlmPill: str('SHOW_LLM_PILL', '') === '1',

  // Additive Plan · Wave A feature flags. Each new surface bolts on *beside* the
  // shipped app behind one of these — on by default so the increment is visible
  // and its reaction signal accrues, but instantly retireable with NEXT_*=0 once
  // a fold decision is made. See docs / RoleProof_Additive_Plan.md.
  nextInterviewBrief: str('NEXT_INTERVIEW_BRIEF', '1') !== '0', // A1 · post-CV interview brief
  nextThisWeek: str('NEXT_THIS_WEEK', '1') !== '0', //           A3 · "This week" board strip
  nextStatement: str('NEXT_STATEMENT', '1') !== '0', //          B1 · activity log → the Statement
  nextReturns: str('NEXT_RETURNS', '1') !== '0', //             B2 · application outcomes → Returns
  nextCoverageMatrix: str('NEXT_COVERAGE_MATRIX', '1') !== '0', // B3 · target Coverage Matrix tab
  nextSourcingCompass: str('NEXT_SOURCING_COMPASS', '1') !== '0', // B4 · source → Sourcing Compass
  nextStory: str('NEXT_STORY', '1') !== '0', //                 C1 · "Your story" through-line tab
  nextDiscover: str('NEXT_DISCOVER', '1') !== '0', //           C2 · Mirror + Unexpected Doors
  nextExcavation: str('NEXT_EXCAVATION', '1') !== '0', //       C3 · Excavation coach session
  nextProofLink: str('NEXT_PROOF_LINK', '1') !== '0', //        C4 · public Proof Link (per-user opt-in)
  // R3 · The Statement's digest email. Deliberately LAST and OFF by default — the
  // in-app re-entry banner ships first (zero infra); email is a thin adapter over the
  // same digest, wired to a trigger only once the banner earns opens.
  nextStatementEmail: str('NEXT_STATEMENT_EMAIL', '0') !== '0', // R3 · monthly Statement digest email
  // R5 · The full Weekly Triage, above the board table. On by default (additive — the
  // raw table stays one scroll down); it supersedes the A3 "This week" strip when on.
  nextTriage: str('NEXT_TRIAGE', '1') !== '0', //               R5 · weekly triage vs the A3 strip
  // R6 · The Transition Ledger — a new lens beside the Statement composing existing
  // streams. Additive, on by default, retireable with NEXT_LEDGER=0.
  nextLedger: str('NEXT_LEDGER', '1') !== '0', //              R6 · the Transition Ledger tab
  // R7 · The assembled Career-Graph page — Coverage Matrix as the primary face, the
  // Statement as its living-history rail. Default layout when on; the strength-meter
  // view stays one click away at /profile?view=meter. Retireable with NEXT_GRAPH_ASSEMBLED=0.
  nextGraphAssembled: str('NEXT_GRAPH_ASSEMBLED', '1') !== '0', // R7 · matrix-first profile
} as const;

export const isLiveLlm = env.llmMode === 'live' && env.deepseekApiKey !== '';
