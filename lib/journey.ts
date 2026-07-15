/**
 * The journey model — the single brain behind the "mission control" experience.
 *
 * The methodology is a staged, gated pipeline (A→B→C→D). This module collapses a lead's
 * raw status + score into a four-stage arc the user can *feel* their way through:
 *
 *     Capture ──▶ Screen ──▶ Tailor ──▶ Apply
 *
 * It answers three questions for any lead:
 *   1. Which stage is each step in?  (done / current / locked / upcoming)
 *   2. What is the single next action?  (the headline CTA)
 *   3. Why is something gated?  (freshness hold, fit below threshold, nothing kept...)
 *
 * Code computes this; the UI only renders it.
 */

import type { Tone } from './ui';
import { normalizeRecommendation } from './db/types';

export type StageKey = 'capture' | 'screen' | 'tailor' | 'apply';
export type StageState = 'done' | 'current' | 'locked' | 'upcoming';

export type StageDef = {
  key: StageKey;
  label: string;
  blurb: string;
  /** The methodology steps that live inside this stage. */
  steps: string;
};

export const STAGES: StageDef[] = [
  { key: 'capture', label: 'Capture', blurb: 'Job lead saved', steps: 'A1' },
  { key: 'screen', label: 'Screen', blurb: 'Role Fit Score', steps: 'B1–B6' },
  { key: 'tailor', label: 'Tailor', blurb: 'Evidence → CV', steps: 'C1–C7' },
  { key: 'apply', label: 'Apply', blurb: 'Submit & track', steps: 'D' },
];

/** Canonical screening sub-steps (B1–B6). */
export const SCREEN_STEPS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'B1', label: 'Freshness & saturation', hint: 'How old / how contested is the posting' },
  { id: 'B2', label: 'Roadblocks', hint: 'Hard blockers (visa, location, clearance)' },
  { id: 'B3', label: 'Misalignments', hint: 'Soft mismatches worth flagging' },
  { id: 'B4', label: 'Skills · JD group · ATS', hint: 'Map to the 17-dimension framework' },
  { id: 'B5', label: 'Extract requirements', hint: 'Rank Core / Important / Nice-to-have' },
  { id: 'B6', label: 'Role fit score', hint: 'Weighted, reproducible 0–10 score' },
];

/** Canonical tailoring sub-steps (C1–C7). */
export const TAILOR_STEPS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'C1', label: 'Format check', hint: 'Detect ATS + structure' },
  { id: 'C2', label: 'Map evidence', hint: 'Link each requirement to profile evidence' },
  { id: 'C3', label: 'Draft bullets', hint: 'Only Keep evidence' },
  { id: 'C4', label: 'Skills section', hint: 'Mirror supported JD keywords' },
  { id: 'C5', label: 'Profile summary', hint: 'Tailored headline + summary' },
  { id: 'C6', label: 'Compile CV', hint: 'Fill the 2-page template by content budget' },
  { id: 'C7', label: 'ATS rating', hint: 'Coverage / keyword check' },
];

const STATUS_STAGE: Record<string, StageKey> = {
  captured: 'capture',
  screening: 'screen',
  hold: 'screen',
  screened: 'screen',
  promoted: 'tailor',
  tailoring: 'tailor',
  ready: 'tailor',
  applied: 'apply',
  archived: 'capture',
};

export type CtaKind =
  | 'screen'
  | 'promote'
  | 'map'
  | 'approve'
  | 'generate'
  | 'download'
  | 'apply'
  | 'none';

export type JourneyInput = {
  status: string;
  scored: boolean;
  recommendation: string | null;
  mappedCount: number;
  mappableRequirementCount?: number;
  keptCount: number;
  cvReady: boolean;
};

export type JourneyResult = {
  stages: Array<StageDef & { state: StageState }>;
  currentKey: StageKey;
  /** Headline guidance for the hero. */
  next: { title: string; detail: string; cta: CtaKind; tone: Tone; blocked: boolean };
  /** 0–100 fill for the rail. */
  progressPct: number;
};

const ORDER: StageKey[] = ['capture', 'screen', 'tailor', 'apply'];

export function canPromote(input: { scored: boolean; recommendation: string | null }): boolean {
  const rec = normalizeRecommendation(input.recommendation);
  return input.scored && (rec === 'Proceed' || rec === 'Borderline');
}

export function journeyState(input: JourneyInput): JourneyResult {
  const current = STATUS_STAGE[input.status] ?? 'capture';
  const currentIdx = ORDER.indexOf(current);
  const promotable = canPromote(input);

  // Tailor is gated off when a lead has been screened but isn't worth pursuing.
  const tailorGated =
    input.scored && !promotable && input.status !== 'promoted' && input.status !== 'tailoring' && input.status !== 'ready';

  const stages = STAGES.map((s): StageDef & { state: StageState } => {
    const idx = ORDER.indexOf(s.key);
    let state: StageState;
    if (idx < currentIdx) state = 'done';
    else if (idx === currentIdx) state = 'current';
    else state = 'upcoming';
    if (s.key === 'tailor' && tailorGated) state = 'locked';
    if (s.key === 'apply' && !input.cvReady && currentIdx < ORDER.indexOf('apply')) {
      // Apply stays upcoming until a CV exists; lock it only if the lead can never get there.
      if (tailorGated) state = 'locked';
    }
    return { ...s, state };
  });

  const next = computeNext(input, promotable);

  // Fill the rail to the centre of the current node, plus a nudge for in-stage progress.
  const base = currentIdx / (ORDER.length - 1);
  const inStage = inStageProgress(input);
  const progressPct = Math.min(
    100,
    Math.round((base + inStage / (ORDER.length - 1)) * 100)
  );

  return { stages, currentKey: current, next, progressPct };
}

function inStageProgress(input: JourneyInput): number {
  // A fraction 0–1 of progress *within* the current stage, for a livelier rail.
  switch (STATUS_STAGE[input.status]) {
    case 'screen':
      return input.scored ? 0.9 : 0.2;
    case 'tailor':
      if (input.cvReady) return 0.95;
      if (input.keptCount > 0) return 0.66;
      if (input.mappedCount > 0) return 0.4;
      return 0.15;
    case 'apply':
      return 1;
    default:
      return 0.1;
  }
}

function computeNext(
  input: JourneyInput,
  promotable: boolean
): JourneyResult['next'] {
  const { status, scored, mappedCount, keptCount, cvReady } = input;

  if (status === 'applied') {
    return { title: 'Application submitted', detail: 'This lead has been applied to and is being tracked.', cta: 'none', tone: 'green', blocked: false };
  }
  if (status === 'archived') {
    return { title: 'Archived', detail: 'This lead is off the active board.', cta: 'none', tone: 'neutral', blocked: false };
  }

  // Tailor stage
  if (status === 'promoted' || status === 'tailoring' || status === 'ready') {
    if (cvReady) {
      return { title: 'CV is ready', detail: 'Download the tailored CV, then mark the lead as applied.', cta: 'download', tone: 'green', blocked: false };
    }
    if ((input.mappableRequirementCount ?? 1) === 0) {
      return { title: 'Extract must-haves', detail: 'This lead has a fit score, but no Core/Important requirements to map yet. Re-run screening first.', cta: 'screen', tone: 'amber', blocked: false };
    }
    if (mappedCount === 0) {
      return { title: 'Map the evidence', detail: 'Link each requirement to your strongest profile evidence (C1–C2).', cta: 'map', tone: 'green', blocked: false };
    }
    if (keptCount === 0) {
      return { title: 'Choose what belongs', detail: 'Mark evidence Keep / Maybe / Drop — only “Keep” reaches the CV.', cta: 'approve', tone: 'amber', blocked: false };
    }
    return { title: `Generate the CV`, detail: `${keptCount} item${keptCount === 1 ? '' : 's'} kept. Compile the 2-page CV (C3–C7).`, cta: 'generate', tone: 'green', blocked: false };
  }

  // Screen stage
  if (!scored) {
    if (status === 'hold') {
      return { title: 'On hold — stale posting', detail: 'This posting looks old. Screen it anyway, or move on.', cta: 'screen', tone: 'amber', blocked: false };
    }
    return { title: 'Run screening', detail: 'Score role fit across B1–B6 to decide whether to invest.', cta: 'screen', tone: 'green', blocked: false };
  }
  if (promotable) {
    return { title: 'Promote to tailoring', detail: 'Fit clears the bar — move this lead into CV tailoring.', cta: 'promote', tone: 'green', blocked: false };
  }
  return { title: 'Below the bar', detail: 'Role fit is too low to be worth tailoring. Re-screen if the JD changed.', cta: 'screen', tone: 'rose', blocked: true };
}
