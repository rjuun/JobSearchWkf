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
  | 'screening'
  | 'hold'
  | 'screened'
  | 'promoted'
  | 'tailoring'
  | 'ready'
  | 'applied'
  | 'archived';

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
 * Single source of truth for the human-gate vocabulary. The DB enum is still
 * `green/yellow/red` (see schema.ts); the UI says Keep/Maybe/Drop. New UI should
 * read from here so the eventual enum→keep/maybe/drop migration (ROADMAP P6) is a
 * one-line change, not a scavenger hunt.
 */
export type ApprovalStatus = 'pending' | 'green' | 'yellow' | 'red';
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  green: 'Keep',
  yellow: 'Maybe',
  red: 'Drop',
};
