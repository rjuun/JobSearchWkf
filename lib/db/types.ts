/** TS unions for data-derived fields stored as text, plus inferred row types. */
import type { InferSelectModel } from 'drizzle-orm';
import type { jobLeads, jobRequirements, requirementTailoring } from './schema';

export type RequirementRank = 'Core' | 'Important' | 'Nice-to-Have';
export type MatchStrength = 'Excellent' | 'Very Strong' | 'Good' | 'Weak' | 'No Match';
export type Recommendation = 'Proceed' | 'Borderline' | 'Hold' | 'Not recommended';

/**
 * Map legacy stored verdicts (pre-redesign_2, when scoring used Caution / Low
 * priority) onto the canonical plain-language lexicon. `recommendation` is a free
 * `text` column, so leads scored before the rename still carry the old words —
 * normalize on read so the UI and gates never see a stale verdict.
 */
const LEGACY_RECOMMENDATION: Record<string, Recommendation> = {
  Caution: 'Borderline',
  'Low priority': 'Hold',
};
export function normalizeRecommendation(rec: string | null): string | null {
  if (rec == null) return null;
  return LEGACY_RECOMMENDATION[rec] ?? rec;
}
export type JdGroupCode = 'SCD' | 'CSEO' | 'OSS' | 'CFPA' | 'TPM' | 'POESG';
export type LeadStatus =
  | 'captured'
  // ── The B-phase screening gate (Scoring Phase Redesign) ──
  | 'scoring_queue' // B3/B4 flagged something — waiting on a human decision
  | 'roadblocked' //   dropped at the gate: a hard blocker
  | 'misaligned' //    dropped at the gate: a values/culture mismatch
  | 'selected' //      cleared the gate (auto when clean) — queued for batch scoring
  | 'screening' //     transient: B5/B6 in flight
  | 'hold'
  | 'screened'
  | 'promoted'
  | 'tailoring'
  | 'ready'
  | 'applied'
  | 'archived';

/**
 * Past B-phase screening — the posting is stable text at this point and
 * `requirement_tailoring` may carry human-approved rows, so re-running B2–B6
 * here would just re-spend LLM calls for the same answer (`refreshFreshnessAction`'s
 * own doc comment states the design) and, if B2's `tooThin` branch fires, reset
 * review a human already gave. CI · Make C2 Build on B6 Instead of Re-Deriving
 * the Map §2.4 option (3) — read by both the server action gate
 * (app/actions/pipeline.ts) and the client confirm prompt (workspace.tsx).
 */
export const PAST_PROMOTED_STATUSES: readonly string[] = ['promoted', 'tailoring', 'ready', 'applied'];

/** Pure predicate behind the re-screen gate — DB-free so it's testable without
 * a live lead, same pattern as `gateStatusFor` in lib/pipeline/screening.ts.
 * `force` is the deliberate, confirmed override. */
export function rescreenBlocked(status: string, force: boolean): boolean {
  return !force && PAST_PROMOTED_STATUSES.includes(status);
}

export type JobLead = InferSelectModel<typeof jobLeads>;
export type JobRequirement = InferSelectModel<typeof jobRequirements>;
export type RequirementTailoring = InferSelectModel<typeof requirementTailoring>;

/** Requirement-priority weights used by the B6 rollup (Core 3 / Important 2 / Nice 1). */
export const RANK_WEIGHT: Record<string, number> = {
  Core: 3,
  Important: 2,
  'Nice-to-Have': 1,
};

/**
 * Legacy label map for the DB enum (`green/yellow/red`, see schema.ts). Nothing
 * in the live UI currently reads this — the per-row Keep/Maybe/Drop triage that
 * used to display these labels was retired for a single "approve entire map"
 * action, which only ever sets `green`/`pending`. Kept as the one place these
 * words are spelled out, in case a future surface needs to explain a legacy
 * `yellow`/`red` row, or for the eventual enum cleanup (ROADMAP P6).
 */
export type ApprovalStatus = 'pending' | 'green' | 'yellow' | 'red';
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  green: 'Keep',
  yellow: 'Maybe',
  red: 'Drop',
};
