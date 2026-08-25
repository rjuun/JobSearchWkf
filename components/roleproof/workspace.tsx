'use client';

/**
 * RoleProof workspace — the Act II lead "command center", wired to the real
 * pipeline server actions. One client orchestrator holds all interaction state;
 * module-level panels (run / checks / score / triage / CV / next-move / rail /
 * spine) are composed two ways:
 *   • 2A — two-pane command center  (JD pinned left, work rail right)
 *   • 2C — guided vertical spine    (stepper left, one focused stage right)
 *
 * Voice is the plain-language variant from the design's copy. Step ids, model
 * names, and prompt sources are available through compact trace disclosures
 * where auditability matters, without turning the default surface into a log.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  runScreeningAction,
  getRescreenImpactAction,
  promoteLeadAction,
  toggleTargetAction,
  refreshFreshnessAction,
} from '@/app/actions/pipeline';
import { markNotPursuedAction } from '@/app/actions/scoring-queue';
import { mapEvidenceAction, approveAllAction, generateCvAction, setShortlistPinAction } from '@/app/actions/tailoring';
import { addTipAction, resolveTipAction } from '@/app/actions/tips';
import { trackUxAction } from '@/app/actions/ux';
import { summariseRunTrace, totalRuns, type StepTrace } from '@/lib/run-trace';
import { rescreenBlocked } from '@/lib/db/types';
import type { JourneyResult } from '@/lib/journey';
import { provenanceCoverage } from '@/lib/provenance';
import { evidenceNeedsCvSlot } from '@/lib/cv-slots';
import { Mach, CodeBadge } from '@/components/machinery';
import { Frame } from '@/components/layout';
import { cn, RpStagePill, rpVerdict, scoreTone, SCORE_TEXT } from './kit';
import { ApplicationSentControl } from './application-sent-control';
import { PipelineMap, type MapBlock, type MapCredentialSection, type MapPosition } from './pipeline-map';
import type { MapSelection } from '@/lib/selection-view';

export type RpLead = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  isTarget: boolean;
  jdGroupPrimary: string | null;
  atsSystem: string | null;
  // Bare third-party recruiting-agency name (e.g. "Iventa") when the off-site
  // apply link was routed through one — see lib/pipeline/capture-enrich.ts. Null
  // for the common case (ATS/company hires directly).
  hiringAgency: string | null;
  sourceUrl: string | null;
  jobPostLink: string | null;
  overallFitScore: number | null;
  postedDays: number | null;
  freshnessBand: string | null;
  saturationBand: string | null;
  // CI · Lead Liveness Re-check. Tri-state: true = open when last read, false =
  // "No longer accepting applications", null = never checked. Null is not a
  // weaker "false" — nobody has looked.
  acceptingApplications: boolean | null;
  livenessCheckedAt: string | null;
  /** `requirementId` set ⇒ the Map shows a Block chip on that row; unset ⇒ Key Patterns only (§2.5). */
  roadblocks: { dimension: string; detail: string; requirementId?: string }[];
  misalignments: { dimension: string; detail: string }[];
  skillRatings: Record<string, number>;
  keyPatterns: string | null;
};
export type RpReq = {
  id: string;
  requirementOrder: number | null;
  rank: string | null;
  requirement: string;
  description: string | null;
  initialScore: number | null;
  initialMatchStrength: string | null;
  /** Verbatim JD sentence (§3). Null on leads screened before it shipped — §4.3 left those historical. */
  sourceText: string | null;
  // Requirement Skills — JD-facing language extracted at B2 (never AoE codes).
  skills: string[];
};
export type RpRow = {
  id: string;
  /** FK to job_requirements — what lets the Map trace this item to the row(s) it supports. */
  requirementId: string | null;
  requirementLine: string | null;
  evidenceRef: string | null;
  originalText: string | null;
  cvBullet: string | null;
  cvPosition: string | null;
  // Bullet | Education | Language | STAR action | STAR result | Responsibility. Lets the
  // approval gate tell "no slot because Education/Language never gets one"
  // apart from "genuinely unslotted" (see evidenceNeedsCvSlot in cv-slots.ts).
  evidenceKind: string | null;
  approvalStatus: string;
  provSource: string; // imported | coached | swapped
  approvedAt: string | null;
  // Three skill columns, one writer each — CI · Split cv_bullet_skills from
  // requirement_skills. `requirementSkills` is what the JD asks of this
  // requirement (B2, snapshotted at C2 and never rewritten); `mySkills` is the
  // candidate's own vocabulary that answers it (C2's validated selection);
  // `cvBulletSkills` is what the tailored bullet actually displays (C4's tag).
  // Never the same list. Asked-for minus displayed is this row's coverage gap.
  mySkills: string[];
  requirementSkills: string[];
  cvBulletSkills: string[];
  // ── C3 · Select the CV Evidence Set ───────────────────────────────────────
  // `shortlistRank` is C3's verdict: 1..B in the order the selected evidence
  // stands, null for evidence that was Kept but did not make the CV. It is a
  // rank, not an approval — the Keep gate above stays a human judgement about
  // truthfulness. Every row sharing a selected ref carries the same rank.
  shortlistRank: number | null;
  // The owner's override on that verdict: 'pin' | 'exclude' | null.
  shortlistPin: string | null;
};
/**
 * B6's initial requirement→evidence link, scoped to the Master Bullet Bank
 * (CI · B6 Never Receives the Master Bullet Bank). Machine-proposed and not yet
 * reviewed — which is why it has no `approvalStatus`: approval is C2's
 * decision (a single "approve entire map" action, not a per-row one), and
 * rendering these as "pending" would invite a click that does nothing at
 * this stage.
 */
export type RpEvidence = {
  id: string;
  requirementId: string;
  evidenceRef: string;
  evidenceText: string | null;
  /** The Map lane this belongs in: a CV_SLOTS label for a bullet, the ref code for education/languages. */
  slot: string | null;
  note: string | null;
};
export type RunTrace = {
  step: string;
  model: string | null;
  finishedAt: string | null;
};

type Dim = { label: string; value: number | null; weight: number };

type Props = {
  lead: RpLead;
  requirements: RpReq[];
  tailoring: RpRow[];
  /** B6's initial evidence links — what fills the Map's lanes on a screened lead, before C2 runs. */
  initialEvidence: RpEvidence[];
  /** The CV's real shape — the Map's left column. Present in every state, including pre-screening. */
  cvSkeleton: MapPosition[];
  /** Education / Executive Education / Languages — the CV sections below the positions. */
  credentials: MapCredentialSection[];
  jd: string | null;
  journey: JourneyResult;
  recommendation: string | null;
  dims: { label: string; value: number | null }[];
  cvReady: boolean;
  leadTips: { id: string; observation: string }[];
  runTrace: RunTrace[];
  /** C3's standing verdict — CI · C3 §2b. Null before the map is approved. */
  selection: MapSelection | null;
  /** Latest C8 ATS rating from the DB, so the score survives a reload. */
  initialAtsRating: number | null;
  /** True when an OPEN screening-gap coach prompt actually exists for this lead. */
  coachBridge: boolean;
  /** A1 flag: show the post-CV interview brief beside the ready panel. */
  nextInterviewBrief: boolean;
};

const WEIGHTS = [35, 20, 20, 15, 10];
// Plain-language steps shown while the C-pipeline runs live (a few seconds each),
// so the wait reads as deliberate work rather than a frozen button.
const MAP_STEPS = [
  'Reading your career graph',
  'Matching each must-have to your history',
  'Scoring how well the evidence fits',
];
const GEN_STEPS = [
  'Rewriting evidence into CV bullets',
  'Assembling the skills section',
  'Writing your tailored profile',
  'Compiling the 2-page CV',
  'Rating the ATS match',
];
type Ctx = {
  lead: RpLead;
  requirements: RpReq[];
  rows: RpRow[];
  initialEvidence: RpEvidence[];
  cvSkeleton: MapPosition[];
  credentials: MapCredentialSection[];
  jd: string | null;
  journey: JourneyResult;
  recommendation: string | null;
  dims: Dim[];
  cvReady: boolean;
  coachBridge: boolean;
  showInterviewBrief: boolean;
  enrichHref: string;
  leadFlags: { id: string; observation: string }[];
  runTrace: RunTrace[];
  selection: MapSelection | null;
  error: string | null;
  clearError: () => void;
  scored: boolean;
  screenStage: boolean;
  tailorStage: boolean;
  isHold: boolean;
  isReady: boolean;
  running: boolean;
  runStep: number;
  showMaths: boolean;
  toggleMaths: () => void;
  effective: (row: RpRow) => string;
  kept: number;
  atsRating: number | null;
  busy: boolean;
  busyPhase: 'map' | 'generate' | null;
  busyStep: number;
  onScreen: () => void;
  onPromote: () => void;
  onMap: () => void;
  onApproveAll: () => void;
  onGenerate: () => void;
  /** Override C3's shortlist for one piece of evidence — CI · C3 §2.7 item 5.
   *  Keyed by evidence ref, not row id: selection decides per ref, and the same
   *  bullet arrives as several rows. Takes effect on the next Generate CV. */
  onPin: (evidenceRef: string, pin: 'pin' | 'exclude' | null) => void;
  /** §2.4's gate tripped — what re-running screening would touch, shown before
   * the person confirms. Null when there's nothing to confirm. */
  rescreenImpact: { status: string; total: number; green: number } | null;
  onConfirmRescreen: () => void;
  onCancelRescreen: () => void;
};

export function RpWorkspace(props: Props) {
  const { lead, requirements, tailoring, jd, journey, recommendation, cvReady } = props;
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [running, setRunning] = useState(false);
  const [runStep, setRunStep] = useState(0);
  const [showMaths, setShowMaths] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, string>>({});
  const [atsRating, setAtsRating] = useState<number | null>(props.initialAtsRating);
  const [error, setError] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<'map' | 'generate' | null>(null);
  const [busyStep, setBusyStep] = useState(0);
  const [rescreenImpact, setRescreenImpact] = useState<{ status: string; total: number; green: number } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (phaseIntervalRef.current) clearInterval(phaseIntervalRef.current);
  }, []);

  function startPhase(phase: 'map' | 'generate', steps: number) {
    setBusyPhase(phase);
    setBusyStep(0);
    phaseIntervalRef.current = setInterval(() => setBusyStep((s) => Math.min(s + 1, steps - 1)), 750);
  }
  function endPhase() {
    if (phaseIntervalRef.current) clearInterval(phaseIntervalRef.current);
    setBusyPhase(null);
    setBusyStep(0);
  }

  const scored = lead.overallFitScore != null;
  const dims: Dim[] = props.dims.map((d, i) => ({ ...d, weight: WEIGHTS[i] ?? 0 }));
  const effective = (row: RpRow) => overlay[row.id] ?? row.approvalStatus;
  const kept = tailoring.filter((r) => effective(r) === 'green').length;

  // §2.4 option (3) — a lead past `promoted` may carry approved tailoring rows,
  // so the first click surfaces what's at stake instead of firing straight away
  // (CI · Make C2 Build on B6 Instead of Re-Deriving the Map). `force` only
  // ever arrives true from onConfirmRescreen below, never from a raw onClick —
  // React calls onClick handlers with the DOM event, and a truthy event object
  // would otherwise read as an accidental override.
  function onScreen(force = false) {
    if (running) return;
    if (rescreenBlocked(lead.status, force)) {
      setError(null);
      (async () => {
        try {
          setRescreenImpact(await getRescreenImpactAction(lead.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
      return;
    }
    setRescreenImpact(null);
    setError(null);
    setRunning(true);
    setRunStep(0);
    intervalRef.current = setInterval(() => setRunStep((s) => Math.min(s + 1, 5)), 600);
    (async () => {
      try {
        await runScreeningAction(lead.id, force);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setRunning(false);
        router.refresh();
      }
    })();
  }
  function onPromote() {
    startTransition(async () => {
      try {
        setError(null);
        await promoteLeadAction(lead.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        router.refresh();
      }
    });
  }
  function onMap() {
    if (busyPhase) return;
    startPhase('map', MAP_STEPS.length);
    startTransition(async () => {
      try {
        setError(null);
        await mapEvidenceAction(lead.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        endPhase();
        router.refresh();
      }
    });
  }
  // Approves the whole map in one action — replaces the old row-by-row
  // Keep/Maybe/Drop triage. Optimistically flips every approvable (has a CV
  // slot, or is Education/Language kind which never needs one), not-yet-green
  // row to green; reverts the overlay if the action fails.
  function onApproveAll() {
    const approvable = tailoring.filter(
      (r) => effective(r) !== 'green' && (!evidenceNeedsCvSlot(r.evidenceKind) || !!r.cvPosition)
    );
    if (approvable.length === 0) return;
    setOverlay((o) => {
      const next = { ...o };
      for (const r of approvable) next[r.id] = 'green';
      return next;
    });
    startTransition(async () => {
      try {
        setError(null);
        await approveAllAction(lead.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setOverlay((o) => {
          const next = { ...o };
          for (const r of approvable) delete next[r.id];
          return next;
        });
      } finally {
        router.refresh();
      }
    });
  }
  // Override C3's shortlist for one piece of evidence (CI · C3 §2b.3).
  //
  // The action re-solves before it returns, so `router.refresh()` brings back a
  // whole new selection: the pinned card gains its outline and whatever it
  // displaced loses one. No optimistic overlay, deliberately — the trade a pin
  // makes is exactly what cannot be guessed client-side, and showing a pin as
  // free until the server disagrees would hide the one thing worth seeing.
  function onPin(evidenceRef: string, pin: 'pin' | 'exclude' | null) {
    if (busyPhase || !evidenceRef) return;
    startTransition(async () => {
      try {
        setError(null);
        await setShortlistPinAction(lead.id, evidenceRef, pin);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        router.refresh();
      }
    });
  }
  function onGenerate() {
    if (busyPhase) return;
    startPhase('generate', GEN_STEPS.length);
    startTransition(async () => {
      try {
        setError(null);
        const r = await generateCvAction(lead.id);
        setAtsRating(r.atsRating);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        endPhase();
        router.refresh();
      }
    });
  }

  const enrichHref = `/profile?from=${encodeURIComponent(
    `/roleproof/leads/${lead.id}`
  )}&role=${encodeURIComponent(lead.title)}`;

  const c: Ctx = {
    lead,
    requirements,
    rows: tailoring,
    initialEvidence: props.initialEvidence,
    cvSkeleton: props.cvSkeleton,
    credentials: props.credentials,
    jd,
    journey,
    recommendation,
    dims,
    cvReady,
    coachBridge: props.coachBridge,
    showInterviewBrief: props.nextInterviewBrief,
    enrichHref,
    leadFlags: props.leadTips,
    runTrace: props.runTrace,
    selection: props.selection,
    error,
    clearError: () => setError(null),
    scored,
    screenStage: journey.currentKey === 'screen',
    tailorStage: journey.currentKey === 'tailor',
    isHold: lead.status === 'hold' && !scored,
    isReady: cvReady || lead.status === 'ready',
    running,
    runStep,
    showMaths,
    toggleMaths: () => setShowMaths((v) => !v),
    effective,
    kept,
    atsRating,
    busy,
    busyPhase,
    busyStep,
    onScreen: () => onScreen(false),
    onPromote,
    onMap,
    onApproveAll,
    onGenerate,
    onPin,
    rescreenImpact,
    onConfirmRescreen: () => onScreen(true),
    onCancelRescreen: () => setRescreenImpact(null),
  };

  return <TwoPane c={c} />;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * The B phase's step codes, in execution order — ONE definition.
 *
 * This was three separate hardcoded `['B1'…'B6']` literals passed to
 * TraceDisclosure plus a fourth in SCREEN_CODES. The B-phase reorder (CI · Lead
 * Page as Pipeline Canvas §3.1) called that out as the change most likely to
 * break silently: miss one array and its trace panel renders nothing rather than
 * erroring, so nobody finds out. Hoisted so the order can only be wrong in one
 * place. Add or renumber a B step here and every consumer follows.
 */
const B_STEPS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] as const;

const PROMPT_SOURCE: Record<string, string> = {
  B1: 'code rule',
  B2: 'Process/B2',
  B3: 'Process/B3',
  B4: 'Process/B4',
  B5: 'Process/B5',
  B6: 'Process/B6',
  C1: 'code rule',
  C2: 'Process/C2',
  // C3 makes no model call, so it has no STEP_NOTE entry to name here.
  C3: 'code rule',
  C4: 'Process/C4',
  C5: 'code rule',
  C6: 'Process/C6',
  C7: 'DOCX template',
  C8: 'Process/C8',
};

function tracesFor(c: Ctx, steps: readonly string[]): StepTrace[] {
  return summariseRunTrace(c.runTrace, steps);
}

function hasTrace(c: Ctx, steps: readonly string[]): boolean {
  return steps.some((step) => c.runTrace.some((run) => run.step === step));
}

function hasMappableRequirements(c: Ctx): boolean {
  return c.requirements.some((r) => r.rank === 'Core' || r.rank === 'Important');
}

function traceMode(model: string | null): string {
  if (!model) return 'PENDING';
  if (model === 'code') return 'CODE';
  return model.toLowerCase().includes('mock') ? 'MOCK' : 'LIVE';
}

function traceTime(value: string | null): string {
  if (!value) return 'not recorded';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TraceDisclosure({ c, steps, dark = false }: { c: Ctx; steps: readonly string[]; dark?: boolean }) {
  const runs = tracesFor(c, steps);
  if (runs.length === 0) return null;
  return (
    <details
      className={cn(
        'group rounded-[9px] border px-3 py-2',
        dark ? 'border-white/10 bg-white/[0.04]' : 'border-hairline bg-raised/60'
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer select-none items-center justify-between gap-3 text-[11px] font-semibold',
          dark ? 'text-paper/65 hover:text-paper' : 'text-ink-subtle hover:text-ink-muted'
        )}
      >
        <span>Run trace</span>
        {/* Steps covered, plus the raw run count when any step has repeated —
            otherwise "6/6" hides a seventh run behind an unchanged number. */}
        <span className="font-mono text-[10px] opacity-70">
          {runs.length}/{steps.length}
          {totalRuns(runs) > runs.length ? ` · ${totalRuns(runs)} runs` : ''}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {runs.map((run) => (
          <div key={run.step} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span
              className={cn(
                'rounded-[5px] px-1.5 py-0.5 font-mono font-semibold',
                dark ? 'bg-white/10 text-paper/85' : 'bg-paper text-ink-muted ring-1 ring-inset ring-hairline'
              )}
            >
              {run.step}
            </span>
            <span className={cn('font-semibold', dark ? 'text-proof-light' : 'text-proof-deep')}>
              {traceMode(run.model)}
            </span>
            <span className={dark ? 'text-paper/55' : 'text-ink-subtle'}>{run.model ?? 'not run'}</span>
            <span className={dark ? 'text-paper/35' : 'text-ink-subtle'}>·</span>
            <span className={dark ? 'text-paper/55' : 'text-ink-subtle'}>{PROMPT_SOURCE[run.step] ?? 'prompt'}</span>
            <span className={dark ? 'text-paper/35' : 'text-ink-subtle'}>·</span>
            <span className={dark ? 'text-paper/55' : 'text-ink-subtle'}>{traceTime(run.finishedAt)}</span>
            {/* The timestamp above is the LATEST run. Without this a re-checked
                B1 just looks like a step that happened to run later than the
                rest, and the original run — the one the stored score was built
                on — is invisible. */}
            {run.runCount > 1 && (
              <span
                className={cn(
                  'rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold',
                  dark ? 'bg-white/10 text-paper/75' : 'bg-caution-soft text-caution-deep'
                )}
                title={`Run ${run.runCount} times. First run ${traceTime(run.firstAt)}.`}
              >
                re-run ×{run.runCount - 1} · first {traceTime(run.firstAt)}
              </span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function verdictLine(c: Ctx): string {
  const { lead, dims } = c;
  if (lead.overallFitScore == null) return 'Not screened yet — run it to see where you stand.';
  const strong = [...dims]
    .filter((d) => d.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const watch = lead.misalignments?.[0];
  const base = strong ? `Strongest on ${strong.label.toLowerCase()}.` : 'Screened and scored.';
  return watch ? `${base} Watch-out: ${watch.detail || watch.dimension}.` : base;
}

/**
 * The six B steps as plain-language questions, paired with their step code — in
 * EXECUTION ORDER, which is what the live progress card counts through.
 *
 * One array of pairs rather than the two parallel arrays this used to be
 * (`CHECK_QS` + `SCREEN_CODES`, matched by index). The B-phase reorder moved
 * "what are the must-haves?" from fifth to second, and with parallel arrays that
 * kind of change silently mislabels every row after the one you edited — the
 * badge would claim a step that didn't produce that answer. Keeping the question
 * and its code in the same object makes that class of mistake impossible.
 */
const SCREEN_CHECKS = [
  { code: 'B1', q: 'Is this still worth chasing?' },
  { code: 'B2', q: 'What are the must-haves?' },
  { code: 'B3', q: 'Any dealbreakers?' },
  { code: 'B4', q: 'Where might you fall short?' },
  { code: 'B5', q: 'Which of your skills line up?' },
  { code: 'B6', q: 'Overall, is it worth your time?' },
] as const;

// ── layout: 2A two-pane command center ─────────────────────────────────────────

function TwoPane({ c }: { c: Ctx }) {
  const railRef = useRef<HTMLDivElement>(null);
  const railHeight = useRailHeight(railRef);
  return (
    <Frame className="pt-5 pb-24">
      <LeadHeader c={c} />
      {/* `items-start`: the rail keeps its natural height and the JD panel is given
          that height explicitly (see useRailHeight). Stretch alignment cannot do
          this — a grid row is as tall as its TALLEST item, so a long posting makes
          the JD the one setting the height, which is the opposite of §2.3's rule. */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]">
        {/* LEFT · JD reader — height-pinned to the rail, internally scrolled */}
        <JdReader c={c} height={railHeight} />
        {/* RIGHT · work rail */}
        <div ref={railRef} className="flex flex-col gap-4">
          {c.scored ? <ScoreCard c={c} /> : c.isHold ? <HeldCard c={c} /> : <RunCard c={c} />}
          <ActionError c={c} />
          <RescreenConfirm c={c} />
          {c.scored && <JourneyRail stages={c.journey.stages} />}
          {!c.running && !c.busyPhase && c.journey.next.cta !== 'none' && <NextMove c={c} />}
          {/* Key Patterns takes the slot `How RoleProof checked` used to occupy. */}
          <KeyPatternsCard c={c} />
          {c.tailorStage &&
            (c.busyPhase ? (
              <PipelineProgress c={c} />
            ) : c.isReady ? (
              <>
                <CvCard c={c} />
                {c.showInterviewBrief && <InterviewBrief c={c} />}
                <LeftOutCard c={c} />
              </>
            ) : c.rows.length === 0 ? (
              <MapCard c={c} />
            ) : (
              <ApproveMapCard c={c} />
            ))}
          {c.scored && <EnrichBar c={c} />}
        </div>
      </div>
      {/* The Map, below the fold — mounted in every state, including a lead nothing
          has run on. It is the page's product; the panels above are its controls. */}
      <PipelineMap
        positions={c.cvSkeleton}
        credentials={c.credentials}
        requirements={c.requirements.map((r) => ({
          id: r.id,
          order: r.requirementOrder,
          rank: r.rank,
          requirement: r.requirement,
          description: r.description,
          sourceText: r.sourceText,
          initialScore: r.initialScore,
          initialMatchStrength: r.initialMatchStrength,
        }))}
        // Two sources, one lane set, in stage order — never both at once. B6's
        // links land at screening and are what the header has always promised
        // ("evidence lanes fill at B6"); C2's rows supersede them the moment
        // tailoring runs, because those are the same evidence re-picked over the
        // whole Career Graph and carrying a real approval state (pending/green).
        // Merging the two would stack each bullet twice in its slot and make
        // the approval colours meaningless (CI · B6 Never Receives the Master
        // Bullet Bank §2.3).
        evidence={
          c.rows.length > 0
            ? c.rows.map((row) => {
                // C3's place for this evidence, keyed by ref because selection
                // decides per distinct ref and the same bullet arrives as several
                // rows. Absent for Education/Language, which never competed.
                const s = row.evidenceRef ? c.selection?.byRef[row.evidenceRef] : undefined;
                return {
                  id: row.id,
                  requirementIds: row.requirementId ? [row.requirementId] : [],
                  // Education/Language kind never gets a cvPosition (no such CV_SLOTS
                  // entry exists) — same fallback B6's getInitialEvidence already uses,
                  // so these rows land in their credential lane instead of vanishing.
                  slot: evidenceNeedsCvSlot(row.evidenceKind) ? row.cvPosition : row.evidenceRef,
                  text: row.originalText,
                  approvalStatus: row.approvalStatus,
                  groupKey: row.evidenceRef,
                  rank: s?.rank ?? null,
                  gain: s?.gain ?? null,
                  selected: s?.selected ?? false,
                  saturated: s?.saturated ?? false,
                  pin: row.shortlistPin,
                  exempt: !evidenceNeedsCvSlot(row.evidenceKind),
                };
              })
            : c.initialEvidence.map((e) => ({
                id: e.id,
                requirementIds: [e.requirementId],
                slot: e.slot,
                text: e.evidenceText,
                // No approval state exists yet — the neutral chip is the honest
                // rendering of "B6 proposed this; nobody has judged it".
                approvalStatus: 'initial',
                note: e.note,
                // B6 emits one row per (requirement, bullet) pair — this is what
                // collapses them back to one chip per bullet in the lane.
                groupKey: e.evidenceRef,
              }))
        }
        blocks={mappedBlocks(c)}
        leadTitle={c.lead.title}
        company={c.lead.company}
        selection={c.selection}
        // The pin/exclude pass lives between Approve map and Generate, and only
        // there. Once a `tailored.docx` exists the Map is the record of what the
        // CV was built from: ranks and outlines stay, controls go, and clicking a
        // card still lights the requirements it serves (§2b.3).
        canAdjust={!!c.selection && !c.cvReady}
        onPin={c.onPin}
        pinBusy={c.busy}
      />
    </Frame>
  );
}

// ── shared header ──────────────────────────────────────────────────────────────

function LeadHeader({ c }: { c: Ctx }) {
  const { lead } = c;
  // Hiring through a third-party agency (vs. the ATS/company directly) is a
  // signal worth surfacing right next to the company name, not buried in a badge.
  const companyLabel = lead.company && lead.hiringAgency ? `${lead.company} (via ${lead.hiringAgency})` : lead.company;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          {[companyLabel, lead.city].filter(Boolean).join(' · ') || 'Job lead'}
        </div>
        <h1 className="mt-1 font-serif text-[34px] leading-tight text-ink">{lead.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RpStagePill status={lead.status} />
          {/* JD group and ATS are shown as pending rather than hidden when absent:
              an absent chip reads as "this lead has no JD group", where the truth is
              "B5 hasn't run yet". Same reasoning as the freshness chips — the frame
              stays put and fills in. ATS is A1's, so `Unknown` here means the page
              chrome carried no evidence of one (§2.2a), not that a step is pending. */}
          <Chip muted={!lead.jdGroupPrimary}>{lead.jdGroupPrimary ?? 'JD group — pending'}</Chip>
          <Chip muted={!lead.atsSystem}>ATS · {lead.atsSystem ?? 'Unknown'}</Chip>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TargetToggle leadId={lead.id} initial={lead.isTarget} />
        {/* Reachable from any stage — the case this covers (posting closed,
            simply decided not to chase it) isn't limited to Ready to score;
            it's just where it was first noticed. Hidden once a lead is
            already in one of the terminal buckets. */}
        {!['not_pursued', 'archived', 'applied'].includes(lead.status) && <NotPursuedButton leadId={lead.id} />}
        {lead.sourceUrl && <PostingLink href={lead.sourceUrl}>LinkedIn</PostingLink>}
        {lead.jobPostLink && <PostingLink href={lead.jobPostLink}>Company posting</PostingLink>}
      </div>
    </div>
  );
}

/** Mirrors TargetToggle's shape — one button, one server action, router.refresh on success. */
function NotPursuedButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        start(async () => {
          await markNotPursuedAction(leadId);
          setDone(true);
          router.refresh();
        })
      }
      title="Park this lead in Not Pursued — no roadblock or misalignment, just not chasing it."
      className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-muted ring-1 ring-inset ring-hairline transition hover:text-drop hover:ring-drop disabled:opacity-60"
    >
      {busy ? 'Marking…' : 'Not pursued'}
    </button>
  );
}

/**
 * Flag this role as a target (M1). Flagging grows the strength meter's relevancy
 * headroom and pulls the role's Core/Important requirements into the coach queue.
 */
function TargetToggle({ leadId, initial }: { leadId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={busy}
      onClick={() =>
        start(async () => {
          setOn(await toggleTargetAction(leadId));
        })
      }
      title={on ? 'A role you’re chasing — feeds strength & coach. Click to unflag.' : 'Flag as a role you’re chasing'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset transition disabled:opacity-60',
        on ? 'bg-proof text-white ring-proof' : 'bg-surface text-ink-muted ring-hairline hover:text-ink'
      )}
    >
      <span aria-hidden>{on ? '★' : '☆'}</span>
      {on ? 'Target' : 'Flag as target'}
    </button>
  );
}

function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-raised px-3 py-1 text-[11px] font-semibold ring-1 ring-inset ring-hairline',
        muted ? 'text-ink-subtle' : 'text-ink-muted'
      )}
    >
      {children}
    </span>
  );
}

function PostingLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-3 py-1 text-[11px] font-semibold text-ink-muted transition hover:border-proof-ring hover:text-proof-deep"
    >
      {children}
      <span aria-hidden className="text-[10px]">
        ↗
      </span>
    </a>
  );
}

// ── JD reader + Key Patterns ─────────────────────────────

/**
 * Areas-of-Expertise rating labels (B5). Renamed from Core / Important /
 * Supporting (CI · Lead Page as Pipeline Canvas §2.2c): those words also name the
 * requirement ranks that B2 assigns, and two different scales sharing a vocabulary
 * on the same page is what made it look like requirement ranking happened in B5.
 * `Core` / `Important` / `Nice-to-Have` belongs to requirements only — see
 * REQ_RANK_* in the Map. Values 1/2/3 are unchanged; only the words moved.
 */
const SKILL_RANK_WORD: Record<number, string> = { 1: 'Central', 2: 'Contributing', 3: 'Peripheral' };
const SKILL_RANK_PILL: Record<number, string> = {
  1: 'bg-proof-soft text-proof-deep',
  2: 'bg-caution-soft text-caution-deep',
  3: 'bg-raised text-ink-muted',
};

/**
 * The work rail's measured height, for pinning the JD panel to it (§2.3).
 *
 * This has to be measured; CSS cannot express it. A grid row is as tall as its
 * tallest item, so `h-full` on the JD panel resolves to "as tall as the tallest
 * column" — and for any posting longer than the rail, that column IS the JD. The
 * panel grew to fit the whole posting, no scrollbar ever appeared, and the Map got
 * pushed down the page by however long the JD happened to be. Subgrid and
 * container queries don't help: the constraint is "size to my sibling's content",
 * which no layout mode offers.
 *
 * The dependency runs one way only — the rail's height never depends on the JD's —
 * so setting the JD's height from the rail cannot feed back into a resize loop.
 * That direction is the whole reason this is safe, and it's why the JD panel must
 * keep `overflow: hidden` and never be the observed element.
 *
 * Returns null below `lg`, where the columns stack: there is no sibling beside the
 * posting to match, and pinning would crop it to the height of a rail sitting
 * underneath it.
 */
function useRailHeight(railRef: React.RefObject<HTMLElement>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const wide = window.matchMedia('(min-width: 1024px)');
    // Round to whole pixels: sub-pixel layout jitter would otherwise churn state
    // on every fractional reflow for no visible gain.
    const sync = () => setHeight(wide.matches ? Math.round(el.getBoundingClientRect().height) : null);
    sync();
    // Observing the rail covers the cases a resize listener misses — expanding
    // "See the breakdown", a flag list arriving after screening, an error banner.
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    wide.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      wide.removeEventListener('change', sync);
    };
  }, [railRef]);
  return height;
}

/**
 * `The role` — the posting, and nothing else.
 *
 * The `Must-haves` and `Skills` tabs are gone (§2.3). They were exactly backwards:
 * requirements are what the whole B phase produces, and they sat hidden one click
 * behind the JD. They now live in the Map, at full width, with their JD source
 * quoted — and skills surface through the JD-group chip in the header. `The role`
 * is a plain header now, not a tab, because there is nothing to switch between.
 *
 * The freed header space carries the freshness and saturation chips, which is
 * where B1's output belongs: two cheap objective facts about the posting, next to
 * the posting.
 *
 * HEIGHT IS PINNED, deliberately. `h-full` + `min-h-0` + an internally scrolling
 * body makes this panel exactly as tall as the right-hand column, whatever the
 * posting's length. That is the one thing keeping the Map's top edge at a constant
 * Y — without it a long JD pushes the Map down the page and the canvas moves
 * every time you open a different lead.
 */
function JdReader({ c, height }: { c: Ctx; height: number | null }) {
  const jd = c.jd;
  return (
    <div
      // An explicit pixel height, not a class: the value is the rail's measured
      // height and only exists at runtime. `null` (mobile, or before the first
      // measurement) falls back to natural height — the posting is never cropped
      // by a height we haven't actually established.
      style={height != null ? { height } : undefined}
      className="flex min-h-0 flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline px-4 py-2.5">
        <span className="border-b-2 border-proof pb-1 text-[12px] font-semibold text-ink">The role</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <FreshnessChip c={c} />
          <SaturationChip c={c} />
          <LivenessChip c={c} />
          <RecheckPostingButton c={c} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {jd ? (
          <p className="whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-muted">{jd.trim()}</p>
        ) : (
          <p className="text-sm text-ink-subtle">The posting text hasn’t been captured for this lead.</p>
        )}
      </div>
      <div className="border-t border-hairline px-4 py-2 text-[10.5px] text-ink-subtle">
        Full posting · scroll for the rest · height pinned to the right column
      </div>
    </div>
  );
}

/**
 * B1's freshness band as a colour-coded chip, on the ramp from `B1 §C`:
 * green 0–7 days / yellow 8–21 / orange 22–60 / red 61–120 / dark 120+.
 *
 * Bands are read from `freshnessBand`, which lib/scoring owns — deriving them from
 * `postedDays` here would be a second copy of the thresholds, free to drift from
 * the one the pipeline actually scores against.
 */
const FRESHNESS_TONE: Record<string, string> = {
  'very fresh': 'bg-proof-soft text-proof-deep ring-proof-ring',
  fresh: 'bg-proof-soft text-proof-deep ring-proof-ring',
  recent: 'bg-caution-soft text-caution-deep ring-caution-ring',
  ageing: 'bg-[#fde9d4] text-[#854f0b] ring-[#f0c99a]',
  aging: 'bg-[#fde9d4] text-[#854f0b] ring-[#f0c99a]',
  stale: 'bg-drop-soft text-drop-deep ring-drop-ring',
  'very stale': 'bg-ink text-paper ring-ink',
};
const SATURATION_TONE: Record<string, string> = {
  low: 'bg-proof-soft text-proof-deep ring-proof-ring',
  moderate: 'bg-caution-soft text-caution-deep ring-caution-ring',
  high: 'bg-drop-soft text-drop-deep ring-drop-ring',
};
const PENDING_TONE = 'bg-raised text-ink-subtle ring-hairline';

/**
 * Whether the posting still takes applications — CI · Lead Liveness Re-check.
 *
 * Renders nothing at all when `acceptingApplications` is null. That is the
 * point: "never checked" is not a finding, and a grey "unknown" chip on every
 * lead would be noise on the ~2/3 that have no URL to re-read.
 */
function LivenessChip({ c }: { c: Ctx }) {
  const accepting = c.lead.acceptingApplications;
  if (accepting == null) return null;
  return accepting ? (
    <MetricChip tone="bg-proof-soft text-proof-deep ring-proof-ring" dot="bg-current">
      still accepting
    </MetricChip>
  ) : (
    <MetricChip tone="bg-caution-soft text-caution-deep ring-caution-ring" dot="bg-current">
      <b className="font-bold">no longer accepting applications</b>
    </MetricChip>
  );
}

/**
 * Re-read the posting: B1 again, against the live page rather than the values
 * frozen at capture. Shown only when there is a LinkedIn URL to follow — the
 * host check mirrors `linkedInJobId`, deliberately duplicated rather than
 * imported, because pulling a server module into this client bundle to test a
 * hostname would be the more expensive mistake.
 *
 * Note this refreshes freshness and liveness but NOT saturation: LinkedIn's
 * guest fragment carries no applicant count. The button says "posting", not
 * "everything", for that reason.
 */
function RecheckPostingButton({ c }: { c: Ctx }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const url = c.lead.sourceUrl ?? c.lead.jobPostLink ?? '';
  const isLinkedIn = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(url);
  if (!isLinkedIn) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await refreshFreshnessAction(c.lead.id);
          router.refresh();
        })
      }
      className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-ink-subtle ring-1 ring-inset ring-hairline transition hover:bg-raised hover:text-ink disabled:opacity-50"
      title="Re-read the LinkedIn posting: posted date and whether it still accepts applications. Applicant count is not available from the public page."
    >
      {pending ? 'checking…' : 're-check posting'}
    </button>
  );
}

function MetricChip({ tone, dot, children }: { tone: string; dot: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ring-1 ring-inset',
        tone
      )}
    >
      <span className={cn('h-[6px] w-[6px] shrink-0 rounded-full', dot)} />
      {children}
    </span>
  );
}

function FreshnessChip({ c }: { c: Ctx }) {
  const band = c.lead.freshnessBand;
  // Grey until B1 has run — a lead captured a minute ago genuinely has no band
  // yet, and showing "very fresh" before the check would be asserting a result.
  if (!band) return <MetricChip tone={PENDING_TONE} dot="bg-ink-subtle/50">freshness — pending</MetricChip>;
  const tone = FRESHNESS_TONE[band.toLowerCase()] ?? PENDING_TONE;
  const days = c.lead.postedDays;
  return (
    <MetricChip tone={tone} dot="bg-current">
      {days != null ? `${days} day${days === 1 ? '' : 's'} · ` : ''}
      <b className="font-bold">{band}</b>
    </MetricChip>
  );
}

function SaturationChip({ c }: { c: Ctx }) {
  const band = c.lead.saturationBand;
  if (!band) return <MetricChip tone={PENDING_TONE} dot="bg-ink-subtle/50">applicants — pending</MetricChip>;
  const tone = SATURATION_TONE[band.toLowerCase()] ?? PENDING_TONE;
  return (
    <MetricChip tone={tone} dot="bg-current">
      <b className="font-bold">{band}</b> competition
    </MetricChip>
  );
}

/**
 * Key Patterns — B5's prose, then the two flag sections.
 *
 * Takes the slot `How RoleProof checked` occupied, and the difference is the whole
 * argument of §2.2/§2.3: that box restated in plain English what the six steps had
 * done, while every fact it named already existed as a real field. This shows the
 * fields.
 *
 * The two flag sections are deliberately NOT styled alike, because they do not mean
 * the same thing (§2.2d):
 *   • Roadblocks — oxblood. These gate the lead.
 *   • Misalignments — red. Awareness only, and they gate nothing. `B4. Identify
 *     Misalignments` says so twice in bold; a lead with three misalignments and no
 *     roadblock is still perfectly viable and still reaches the user's desk.
 * Anyone tempted to unify these into one "flags" list should read §2.2d first —
 * the distinction is the point, not styling variety.
 */
function KeyPatternsCard({ c }: { c: Ctx }) {
  const { lead } = c;
  const roadblocks = lead.roadblocks ?? [];
  const misalignments = lead.misalignments ?? [];
  const patterns = lead.keyPatterns?.trim();
  const flagCount = roadblocks.length + misalignments.length;
  const empty = !patterns && flagCount === 0;

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-raised px-4 py-3">
        <span className="text-[13px] font-semibold text-ink">Key patterns</span>
        {flagCount > 0 && (
          <span className="ml-auto text-[11px] font-semibold text-ink-subtle">
            {flagCount} flag{flagCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="px-4 py-3">
        {empty ? (
          <p className="text-[12px] italic text-ink-subtle">
            Nothing recorded yet — key patterns are written at B5, flags at B3–B4.
          </p>
        ) : (
          <>
            {patterns ? (
              <p className="text-[12.5px] leading-relaxed text-ink-muted">{patterns}</p>
            ) : (
              <p className="text-[11.5px] italic text-ink-subtle">Key patterns are written at B5.</p>
            )}

            {roadblocks.length > 0 && (
              <div className="mt-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#7a1f1f]">
                  Roadblocks — these gate the lead
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {roadblocks.map((r, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink-muted">
                      <span className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#7a1f1f]" />
                      <span>
                        <b className="font-semibold text-[#7a1f1f]">{r.dimension}:</b> {r.detail}
                        {/* Mapped roadblocks also show as a Block chip on their requirement
                            row in the Map; unmapped ones exist only here. Saying which is
                            which is what stops the two surfaces looking inconsistent. */}
                        {r.requirementId && (
                          <span className="text-ink-subtle"> · shown as Block on its requirement</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {misalignments.length > 0 && (
              <div className="mt-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-drop-deep">
                  Misalignments — awareness only, not a gate
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {misalignments.map((m, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink-muted">
                      <span className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full bg-drop" />
                      <span>
                        <b className="font-semibold text-drop-deep">{m.dimension}:</b> {m.detail}
                      </span>
                    </li>
                  ))}
                </ul>
                {/* The B → Coach bridge, relocated from the deleted checks card. It
                    belongs beside the misalignments now: "where might you fall short"
                    is exactly what this section answers. Still gated on an OPEN prompt
                    actually existing, so the CTA can never dead-end. */}
                {c.coachBridge && (
                  <Link
                    href={`/profile/coach?lead=${lead.id}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-[7px] bg-proof px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-proof-deep"
                  >
                    + Add the evidence with your coach →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <AreasOfExpertisePanel c={c} />
      {hasTrace(c, B_STEPS) && (
        <div className="border-t border-hairline px-4 py-3">
          <TraceDisclosure c={c} steps={B_STEPS} />
        </div>
      )}
    </div>
  );
}

/**
 * The 17 Areas of Expertise ratings, collapsed.
 *
 * §2.3 deletes the `Skills` tab and says ratings surface "via the JD-group chip and
 * the Areas of Expertise panel" — this is that panel. Collapsed by default because
 * the ratings are an input to the JD-group decision rather than something the user
 * acts on per lead: the chip in the header is the answer, this is the working. It
 * would have been easy to delete the tab and surface nothing, which would have
 * quietly dropped the only place B5's output was ever visible.
 */
function AreasOfExpertisePanel({ c }: { c: Ctx }) {
  // Sorted by rating so Central items lead — the ordering carries the same
  // "what matters here" signal as the Map's tier band.
  const entries = Object.entries(c.lead.skillRatings ?? {}).sort((a, b) => a[1] - b[1]);
  if (entries.length === 0) return null;
  return (
    <details className="group border-t border-hairline">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 text-[11px] font-semibold text-ink-subtle hover:text-ink-muted">
        <span>Areas of expertise · {c.lead.jdGroupPrimary ?? 'no JD group'}</span>
        <span className="font-mono text-[10px] opacity-70">{entries.length}</span>
      </summary>
      <div className="px-4 pb-3">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-subtle">
          {([1, 2, 3] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  r === 1 ? 'bg-proof' : r === 2 ? 'bg-caution' : 'bg-ink-subtle'
                )}
              />
              {SKILL_RANK_WORD[r]}
            </span>
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
          {entries.map(([name, rating]) => (
            <li key={name} className="flex items-center justify-between gap-2 py-0.5">
              <span className="truncate text-[11.5px] text-ink-muted">{name}</span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold',
                  SKILL_RANK_PILL[rating] ?? SKILL_RANK_PILL[3]
                )}
              >
                {SKILL_RANK_WORD[rating] ?? SKILL_RANK_WORD[3]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Roadblocks that name a requirement, narrowed to requirement rows that actually
 * exist. The id check is not paranoia: `job_requirements` rows can be re-extracted
 * (B2 skips only when rows are already present), and a stale `requirementId` left
 * on a roadblock would otherwise render a Block chip against nothing.
 */
function mappedBlocks(c: Ctx): MapBlock[] {
  const ids = new Set(c.requirements.map((r) => r.id));
  return (c.lead.roadblocks ?? [])
    .filter((r): r is { dimension: string; detail: string; requirementId: string } =>
      typeof r.requirementId === 'string' && ids.has(r.requirementId)
    )
    .map((r) => ({ requirementId: r.requirementId, detail: r.detail, dimension: r.dimension }));
}

// ── panels ───────────────────────────────────────────────────────────────────

function ActionError({ c }: { c: Ctx }) {
  if (!c.error) return null;
  return (
    <div className="flex items-start gap-3 rounded-card border border-drop-ring bg-drop-soft px-4 py-3 text-[13px] text-drop-deep">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-drop text-[12px] font-bold text-white">
        !
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Action could not complete</div>
        <div className="mt-0.5 text-ink-muted">{c.error}</div>
      </div>
      <button
        type="button"
        onClick={c.clearError}
        className="shrink-0 px-1 text-[15px] leading-none text-drop-deep/70 hover:text-drop-deep"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/**
 * §2.4's confirm-and-override step — a lead past `promoted` can still be
 * re-screened, just not silently. Shown once `onScreen` has fetched what a
 * re-run would touch; `onConfirmRescreen` is the only caller that ever passes
 * `force: true` into `runScreeningAction`.
 */
function RescreenConfirm({ c }: { c: Ctx }) {
  if (!c.rescreenImpact) return null;
  const { status, total, green } = c.rescreenImpact;
  return (
    <div className="flex items-start gap-3 rounded-card border border-caution-ring bg-caution-soft px-4 py-3 text-[13px] text-caution-deep">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-caution text-[12px] font-bold text-white">
        !
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Re-screen a {status} lead?</div>
        <div className="mt-0.5 text-ink-muted">
          {total === 0
            ? "No requirement→evidence rows exist yet for this lead, so there's nothing to lose — this should be safe."
            : `${total} requirement→evidence row${total === 1 ? '' : 's'} exist${total === 1 ? 's' : ''} for this lead, ` +
              `${green} approved. Re-screening just re-spends LLM calls on the same static posting, and a thin ` +
              `extraction can reset review you've already given.`}
        </div>
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={c.onConfirmRescreen}
            className="rounded-[8px] bg-caution px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-caution-deep"
          >
            Re-screen anyway
          </button>
          <button
            type="button"
            onClick={c.onCancelRescreen}
            className="rounded-[8px] border border-caution-ring bg-surface px-3 py-1.5 text-[12px] font-bold text-caution-deep transition hover:bg-caution-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RunCard({ c }: { c: Ctx }) {
  if (c.running) return <ChecksCard c={c} />;
  return (
    <div className="rounded-card border border-hairline bg-surface p-6 shadow-card">
      <div className="font-serif text-[24px] leading-snug text-ink">Should you spend time on this one?</div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        RoleProof will read the posting and compare it to your career history — in plain English, one
        question at a time. Takes a few seconds.
      </p>
      <button
        type="button"
        onClick={c.onScreen}
        className="mt-4 rounded-[9px] bg-proof px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep"
      >
        ▶ Screen this role
      </button>
    </div>
  );
}

function HeldCard({ c }: { c: Ctx }) {
  return (
    <div className="rounded-card border border-drop-ring bg-drop-soft p-6">
      <div className="font-serif text-[23px] leading-snug text-drop-deep">
        Worth a second look before you invest
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        This posting is{' '}
        <b className="text-drop-deep">
          {c.lead.postedDays ?? 'many'} day{c.lead.postedDays === 1 ? '' : 's'} old
        </b>
        . Older roles
        are often filled or stale — screen it anyway, or set it aside.
      </p>
      <div className="mt-4 flex gap-2.5">
        <button
          type="button"
          onClick={c.onScreen}
          className="rounded-[9px] border border-hairline bg-surface px-4 py-2.5 text-[13px] font-bold text-ink transition hover:bg-raised"
        >
          Screen anyway
        </button>
      </div>
    </div>
  );
}

/**
 * Live screening progress — "step N of 6" while B1→B6 run.
 *
 * This used to be two components in one: a live progress card AND a post-hoc
 * "How RoleProof checked" summary of six plain-English answers. The summary is
 * gone (CI § 2.3): every fact it restated already exists as a first-class field
 * elsewhere on the page — freshness and saturation as header chips, roadblocks and
 * misalignments in Key Patterns, requirements in the Map, skills in the JD-group
 * chip, the score in the score card — so it was narration of process where the
 * page should show product. `buildChecks` went with it.
 *
 * The live variant stays, because a progress card during a multi-second run is
 * doing real work: it says which step is in flight rather than freezing a button.
 */
function ChecksCard({ c }: { c: Ctx }) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-raised px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-caution" />
        <span className="text-[13px] font-semibold text-ink">Screening — reading the posting</span>
        <span className="ml-auto text-[11px] font-semibold text-ink-subtle">
          step {Math.min(c.runStep + 1, SCREEN_CHECKS.length)} of {SCREEN_CHECKS.length}
        </span>
      </div>
      <div className="p-1.5">
        {SCREEN_CHECKS.map(({ code, q }, i) => {
          const done = i < c.runStep;
          const isRun = i === c.runStep;
          return (
            <div
              key={code}
              className={cn(
                'flex items-start gap-3 rounded-[8px] px-3 py-2.5',
                isRun && 'bg-raised',
                !done && !isRun && 'opacity-45'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  done
                    ? 'bg-proof-soft text-proof-deep'
                    : isRun
                      ? 'bg-caution-soft text-caution-deep'
                      : 'bg-raised text-ink-subtle'
                )}
              >
                {done ? '✓' : isRun ? '⟳' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">
                  {q} <CodeBadge code={code} />
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-ink-subtle">
                  {isRun ? 'thinking…' : done ? 'done' : 'up next'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-hairline px-4 py-2.5 text-[11px] text-ink-subtle">
        RoleProof reads the posting and compares it to your history · stop anytime
      </div>
    </div>
  );
}

function ScoreCard({ c }: { c: Ctx }) {
  const { lead } = c;
  return (
    <div className="rounded-card bg-ink p-6 text-paper">
      <div className="flex items-center gap-5">
        <div className="text-center">
          <div className="font-serif text-[50px] leading-[0.85] text-proof-light">
            {lead.overallFitScore?.toFixed(1) ?? '—'}
          </div>
          <div className="mt-1 text-[10px] text-paper/55">fit /10</div>
        </div>
        <div className="h-11 w-px bg-paper/15" />
        <div className="flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-proof-light px-3 py-1 text-[12px] font-bold text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-ink" />
            {rpVerdict(lead.overallFitScore)}
          </span>
          <CodeBadge code="B6" className="ml-2 bg-proof-light/25 text-proof-light" />
        </div>
      </div>
      <p className="mt-4 font-serif text-[20px] leading-snug text-paper">{verdictLine(c)}</p>
      <Mach>
        <div className="mt-2 font-mono text-[10px] text-paper/45">
          0.35·rel + 0.20·sen + 0.20·imp + 0.15·req + 0.10·ats
        </div>
      </Mach>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={c.toggleMaths}
          className="text-[12px] font-semibold text-proof-light transition hover:text-white"
        >
          {c.showMaths ? 'Hide the breakdown' : 'See the breakdown'}
        </button>
        <button
          type="button"
          onClick={c.onScreen}
          disabled={c.running}
          className="text-[12px] font-medium text-paper/55 transition hover:text-paper/85 disabled:opacity-50"
        >
          {c.running ? 'Re-screening…' : 'Re-run screening'}
        </button>
      </div>
      {c.showMaths && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-paper/10 pt-3">
          {c.dims.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="w-[78px] text-[11px] text-paper/65">{d.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
                <span
                  className="block h-full rounded-full bg-proof-light"
                  style={{ width: `${Math.round((d.value ?? 0) * 10)}%` }}
                />
              </span>
              <span className="w-[52px] text-right font-mono text-[11px] text-paper/85">
                {d.value != null ? d.value.toFixed(1) : '—'}
                <span className="text-paper/40">·{d.weight}</span>
              </span>
            </div>
          ))}
          <div className="text-[11px] text-paper/45">
            Weighted the same way every time — a consistent, explainable number, not a mood.
          </div>
          <TraceDisclosure c={c} steps={B_STEPS} dark />
        </div>
      )}
    </div>
  );
}

function NextMove({ c }: { c: Ctx }) {
  const { next } = c.journey;
  if (next.blocked) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-drop-ring bg-drop-soft px-5 py-4">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-drop text-[13px] font-bold text-white">
          !
        </span>
        <div>
          <div className="text-[14px] font-bold text-drop-deep">{next.title}</div>
          <div className="mt-0.5 text-[12px] text-ink-muted">{next.detail}</div>
        </div>
      </div>
    );
  }
  const action = nextAction(c);
  return (
    <div className="flex items-center gap-3 rounded-card bg-proof px-5 py-4 text-white">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/20 text-[14px]">→</span>
      <div className="flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/80">
          Your next move
        </div>
        <div className="text-[15px] font-bold">{next.title}</div>
      </div>
      {action}
    </div>
  );
}

function nextAction(c: Ctx) {
  const cta = c.journey.next.cta;
  const cls =
    'shrink-0 rounded-[8px] bg-white px-4 py-2 text-[13px] font-bold text-proof-deep transition hover:bg-paper disabled:opacity-60';
  if (cta === 'download')
    return c.lead.status === 'applied' ? (
      <span className={cn(cls, 'cursor-default opacity-90')}>Applied ✓</span>
    ) : (
      <span className="flex shrink-0 items-start gap-2">
        <a href={`/api/cv/${c.lead.id}`} className={cls}>
          Download
        </a>
        {/* Was a plain "Mark applied" button calling markAppliedAction, which
            wrote applications.status = 'applied' — a status the new Applications
            list doesn't query, so a send confirmed here would never show up
            there. It's now the same drop-or-confirm control the board uses, and
            writes 'response_pending' (CI Part 2 §2.2.H). */}
        <ApplicationSentControl leadId={c.lead.id} variant="panel" className="w-[220px]" />
      </span>
    );
  const map: Partial<Record<string, () => void>> = {
    screen: c.onScreen,
    promote: c.onPromote,
    map: hasMappableRequirements(c) ? c.onMap : c.onScreen,
    approve: c.onApproveAll,
    generate: c.onGenerate,
  };
  const labels: Partial<Record<string, string>> = {
    screen: 'Screen',
    promote: 'Promote',
    map: hasMappableRequirements(c) ? 'Map' : 'Extract must-haves',
    generate: 'Generate',
    approve: 'Approve map',
  };
  const fn = map[cta];
  if (!fn) return <span className={cn(cls, 'cursor-default opacity-90')}>{labels[cta] ?? 'Go'}</span>;
  return (
    <button type="button" onClick={fn} disabled={c.busy} className={cls}>
      {labels[cta] ?? 'Go'}
    </button>
  );
}

// The enrich-on-gap loop: a gap the AI couldn't evidence → strengthen the graph → return.
function EnrichBar({ c }: { c: Ctx }) {
  return (
    <div className="rounded-card border border-dashed border-proof-ring bg-proof-soft/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-ink-muted">
          Spotted a gap the AI couldn’t evidence?{' '}
          <Link href={c.enrichHref} className="font-semibold text-proof-deep hover:underline">
            Strengthen your Career Graph →
          </Link>
        </div>
        <FlagIssue leadId={c.lead.id} />
      </div>
      {c.leadFlags.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-t border-proof-ring/50 pt-2.5">
          {c.leadFlags.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-2 text-[12px]">
              <span className="text-ink-muted">
                <span className="text-caution">⚑</span> {f.observation}
              </span>
              <ResolveFlag id={f.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolveFlag({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set('id', id);
          await resolveTipAction(fd);
          router.refresh();
        })
      }
      className="shrink-0 text-[11px] font-medium text-ink-subtle transition hover:text-proof-deep disabled:opacity-50"
    >
      {busy ? '…' : 'Resolve'}
    </button>
  );
}

function FlagIssue({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, start] = useTransition();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-[11px] font-medium text-ink-subtle transition hover:text-ink-muted"
      >
        ⚑ Flag an accuracy issue
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What looked off?"
        className="w-44 rounded-field border border-hairline bg-surface px-2.5 py-1 text-[12px] text-ink outline-none focus:border-proof"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set('jobLeadId', leadId);
            fd.set('type', 'Data Capture');
            fd.set('observation', text.trim());
            await addTipAction(fd);
            setText('');
            setOpen(false);
            router.refresh();
          })
        }
        className="rounded-field bg-proof px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-proof-deep disabled:opacity-50"
      >
        {busy ? '…' : 'Send'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1 text-[13px] text-ink-subtle hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

function MapCard({ c }: { c: Ctx }) {
  if (!hasMappableRequirements(c)) {
    return (
      <div className="rounded-card border border-caution-ring bg-caution-soft/60 p-6 shadow-card">
        <div className="font-serif text-[22px] leading-snug text-ink">Extract must-haves first</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          This lead has a fit score, but no Core or Important requirements were stored. RoleProof needs
          those must-haves before it can map evidence.
        </p>
        <button
          type="button"
          onClick={c.onScreen}
          disabled={c.busy || c.running}
          className="mt-4 rounded-[9px] bg-proof px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
        >
          {c.running ? 'Extracting…' : 'Re-run screening'}
        </button>
        {hasTrace(c, B_STEPS) && (
          <div className="mt-4">
            <TraceDisclosure c={c} steps={B_STEPS} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-card border border-hairline bg-surface p-6 shadow-card">
      <div className="font-serif text-[22px] leading-snug text-ink">Map your evidence</div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        RoleProof matches each must-have to a piece of your real history. You’ll approve what genuinely
        belongs next.
      </p>
      <button
        type="button"
        onClick={c.onMap}
        disabled={c.busy}
        className="mt-4 rounded-[9px] bg-proof px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
      >
        {c.busy ? 'Matching…' : 'Match the evidence'}
      </button>
      {hasTrace(c, ['C1', 'C2', 'C3']) && (
        <div className="mt-4">
          <TraceDisclosure c={c} steps={['C1', 'C2', 'C3']} />
        </div>
      )}
    </div>
  );
}

/**
 * Approves the whole map in one action (retires the old row-by-row Keep /
 * Maybe / Drop triage — the owner's call: reviewing 16 rows one at a time is a
 * redundant step when the full Requirement → evidence map is already visible
 * below). A row still needs a CV template slot to be Kept, same rule the old
 * per-row Keep enforced — except Education/Language kind rows, which never
 * get one (CV_SLOTS has no such slot; those CV sections render straight from
 * the profile tables regardless of Keep status) and so are exempt.
 */
function ApproveMapCard({ c }: { c: Ctx }) {
  const total = c.rows.length;
  const pending = c.rows.filter((r) => c.effective(r) === 'pending');
  const approvable = pending.filter((r) => !evidenceNeedsCvSlot(r.evidenceKind) || !!r.cvPosition);
  const blocked = pending.filter((r) => evidenceNeedsCvSlot(r.evidenceKind) && !r.cvPosition);
  // Multiple requirement_tailoring ROWS can legitimately share one evidenceRef
  // (CI-034 §2.2 — one bullet may support several requirements), so "N rows"
  // overstates how many distinct pieces of evidence are actually in play.
  // The headline counts unique evidence; the button's own "+N" stays row-based
  // (it's a literal count of rows about to flip to green).
  const approvableEvidenceCount = new Set(approvable.map((r) => r.evidenceRef).filter((ref): ref is string => !!ref)).size;

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      {/* progress strip */}
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="text-[12px] text-ink-muted">
          Evidence <b className="text-ink">{c.kept}</b> / {total}
        </span>
        <div className="flex flex-1 gap-1">
          {c.rows.map((r) => {
            const v = c.effective(r);
            const color = v === 'green' ? 'bg-proof' : v === 'yellow' ? 'bg-caution' : v === 'red' ? 'bg-drop' : 'bg-hairline';
            return <span key={r.id} className={cn('h-[5px] flex-1 rounded-sm', color)} />;
          })}
        </div>
        <button
          type="button"
          onClick={c.onMap}
          disabled={c.busy}
          className="text-[11px] font-medium text-ink-subtle transition hover:text-ink-muted disabled:opacity-50"
        >
          Re-map
        </button>
      </div>
      {hasTrace(c, ['C1', 'C2', 'C3']) && (
        <div className="border-b border-hairline px-4 py-3">
          <TraceDisclosure c={c} steps={['C1', 'C2', 'C3']} />
        </div>
      )}

      {approvable.length > 0 ? (
        <div className="px-5 py-8 text-center">
          <div className="font-serif text-[22px] leading-snug text-ink">
            {approvableEvidenceCount} evidence{approvableEvidenceCount === 1 ? '' : 's'} matched your requirements
          </div>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-ink-muted">
            Across {approvable.length} requirement link{approvable.length === 1 ? '' : 's'} below — approve them all at once rather than one at a time.
          </p>
          {/* Naming C3 here is what turns Approve from a bookkeeping click into a
              step with a visible result. It is also true: approving runs it. */}
          <p className="mx-auto mt-1 max-w-sm text-[11.5px] text-ink-subtle">
            Approving runs C3, which picks the set a two-page CV holds. Free — no model call. You then pin or exclude on
            the Map, before a word is written.
          </p>
          <button
            type="button"
            onClick={c.onApproveAll}
            disabled={c.busy}
            className="mt-4 rounded-[10px] bg-proof px-6 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
          >
            {c.busy ? 'Approving…' : `Approve entire map${c.kept > 0 ? ` (+${approvable.length})` : ''} →`}
          </button>
          {blocked.length > 0 && (
            <p className="mx-auto mt-3 max-w-sm text-[11px] text-ink-subtle">
              {blocked.length} item{blocked.length === 1 ? '' : 's'} need{blocked.length === 1 ? 's' : ''} a CV slot before they can be approved.
            </p>
          )}
        </div>
      ) : c.kept > 0 ? (
        <div className="px-5 py-8 text-center">
          <div className="font-serif text-[24px] text-ink">
            {/* Counted in distinct evidence, not rows: `c.kept` is green ROWS and
                one bullet legitimately answers several requirements, so it runs
                about a third high against a bullet budget. */}
            {c.selection
              ? `${c.selection.selectedCount} of ${c.selection.candidateCount} pieces on the CV`
              : `${c.kept} pieces kept`}
          </div>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-ink-muted">
            {c.selection
              ? 'C3 has chosen. Every approved card on the Map below carries its rank, and the ones that fit are outlined — pin or exclude there until it reads right.'
              : 'Every one is something you can defend in an interview. Ready to assemble the CV.'}
          </p>
          {blocked.length > 0 && (
            <p className="mx-auto mt-1.5 max-w-sm text-[11px] text-ink-subtle">
              {blocked.length} item{blocked.length === 1 ? '' : 's'} left out — no CV slot to place {blocked.length === 1 ? 'it' : 'them'} in.
            </p>
          )}
          <button
            type="button"
            onClick={c.onGenerate}
            disabled={c.busy || c.kept === 0}
            className="mt-4 rounded-[10px] bg-proof px-6 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
          >
            {c.busy ? 'Assembling…' : 'Generate CV →'}
          </button>
        </div>
      ) : (
        <div className="px-5 py-8 text-center">
          <div className="font-serif text-[20px] leading-snug text-ink">No evidence has a CV slot yet</div>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-ink-muted">
            Nothing in this map can be approved until at least one match has a CV Position. Re-map, or fill in the CV
            template's slots.
          </p>
        </div>
      )}
    </div>
  );
}

// Animated progress while the live C-pipeline runs (map: C1–C2, generate: C4–C8).
function PipelineProgress({ c }: { c: Ctx }) {
  const steps = c.busyPhase === 'generate' ? GEN_STEPS : MAP_STEPS;
  const title = c.busyPhase === 'generate' ? 'Assembling your CV' : 'Matching your evidence';
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-raised px-4 py-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-caution" />
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span className="ml-auto text-[11px] font-semibold text-ink-subtle">
          step {Math.min(c.busyStep + 1, steps.length)} of {steps.length}
        </span>
      </div>
      <div className="p-1.5">
        {steps.map((label, i) => {
          const done = i < c.busyStep;
          const isRun = i === c.busyStep;
          return (
            <div
              key={label}
              className={cn(
                'flex items-center gap-3 rounded-[8px] px-3 py-2.5',
                isRun && 'bg-raised',
                !done && !isRun && 'opacity-45'
              )}
            >
              <span
                className={cn(
                  'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  done ? 'bg-proof-soft text-proof-deep' : isRun ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-subtle'
                )}
              >
                {done ? '✓' : isRun ? '⟳' : i + 1}
              </span>
              <span className={cn('text-[12.5px] font-semibold', isRun ? 'text-ink' : 'text-ink-muted')}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-hairline px-4 py-2.5 text-[11px] text-ink-subtle">
        Running live — every claim stays traceable to evidence you kept.
      </div>
    </div>
  );
}

// CI · Requirement Skills vs My Skills — a small labelled badge row so the
// columns are visibly distinct wherever they're shown, not just unlabelled
// tag lists.
function SkillBadgeRow({ label, tone, items }: { label: string; tone: 'proof' | 'neutral'; items: string[] }) {
  const badge =
    tone === 'proof'
      ? 'bg-proof-soft text-proof-deep ring-proof/20'
      : 'bg-surface text-ink-subtle ring-hairline';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      {items.map((s) => (
        <span key={s} className={cn('rounded px-1.5 py-0.5 text-[10.5px] ring-1 ring-inset', badge)}>
          {s}
        </span>
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { imported: 'Imported', coached: 'Coached', swapped: 'Swapped' };
function fmtApproved(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * M7 · "Left out, on purpose" — evidence you deliberately dropped, reframed as interview
 * armament. Lives OUTSIDE the CV paper: the CV stays honest, and you keep an answer ready.
 */
function LeftOutCard({ c }: { c: Ctx }) {
  const left = c.rows.filter((r) => c.effective(r) === 'red' && (r.originalText || r.cvBullet));
  if (left.length === 0) return null;
  return (
    <div className="mt-4 overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="border-b border-hairline px-5 py-3">
        <div className="text-[13px] font-bold text-ink">Left out, on purpose</div>
        <div className="text-[11.5px] text-ink-muted">
          Not on the CV — but if they ask, here’s your honest answer. Shown, not faked.
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-hairline">
        {left.map((r) => (
          <li key={r.id} className="px-5 py-3 text-[12.5px]">
            <div className="font-semibold text-ink">{r.requirementLine ?? 'A requirement'}</div>
            <div className="mt-0.5 text-ink-muted">{r.originalText ?? r.cvBullet}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CvCard({ c }: { c: Ctx }) {
  // Provenance is computed, not asserted: the ledger shows each line with its
  // ref and flags any that don't yet trace, so the summary can never overclaim.
  //
  // What reaches the CV is C3's SHORTLIST, not every Kept row — and it is one
  // line per distinct evidence ref, because one bullet legitimately answers
  // several requirements and arrives here as several rows. This list used to
  // render every green row, so a lead with 64 Kept rows showed 64 "lines on
  // your CV" for a document holding 35 bullets, several of them repeats. On a
  // lead generated before C3 shipped no row carries a rank, and the whole Keep
  // set is still the honest answer (`cov.selected` says which reading applies).
  const kept = c.rows.filter((r) => c.effective(r) === 'green');
  const ranked = kept.filter((r) => r.shortlistRank != null);
  const onCv = ranked.length > 0 ? ranked : kept;
  const lines = [...new Map(onCv.map((r) => [r.evidenceRef ?? `row:${r.id}`, r] as const)).values()].sort(
    (a, b) => (a.shortlistRank ?? 1e9) - (b.shortlistRank ?? 1e9)
  );
  // A count, not a list. The list used to live here as a "Kept but not on this
  // CV" panel carrying pin controls, which is what CI · C3 §2b retired: by the
  // time this card exists the bullets are written and the .docx rendered, so a
  // control here could only ask for a regeneration. The held-back evidence is on
  // the Map, ranked, where the decision is now made — before anything is written.
  // Education/Language are not counted: they never entered the budget (they
  // print from the profile tables regardless), so calling them held back would
  // report a decision C3 never made.
  const leftOut =
    ranked.length > 0
      ? new Set(
          kept
            .filter((r) => r.shortlistRank == null && r.evidenceRef && evidenceNeedsCvSlot(r.evidenceKind))
            .map((r) => r.evidenceRef as string)
        ).size
      : 0;
  const cov = provenanceCoverage(c.rows, c.effective); // the invariant, computed
  const untraced = cov.green - cov.traced;
  return (
    <div className="overflow-hidden rounded-card border border-proof-ring bg-surface shadow-card">
      <div className="flex items-center gap-3 bg-proof px-5 py-4 text-white">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-[15px]">✓</span>
        <div>
          <div className="text-[16px] font-bold">Your CV is ready</div>
          <div className="text-[12px] text-white/90">
            2 pages · tailored to {c.lead.company ?? 'this role'}
          </div>
          <Mach>
            <div className="mt-1 font-mono text-[10px] text-white/70">
              C3 select · C4 draft · C5 skills · C6 profile · C7 compile · C8 ATS rating
            </div>
          </Mach>
        </div>
      </div>
      <div className="flex items-center gap-4 px-5 py-5">
        {c.atsRating != null && (
          <div className="shrink-0 rounded-[10px] border border-proof-ring bg-proof-soft px-4 py-3 text-center">
            <div className="font-serif text-[34px] leading-none text-proof">{c.atsRating}</div>
            <div className="text-[10px] text-proof-deep">ATS score</div>
          </div>
        )}
        <ul className="flex flex-1 flex-col gap-1.5 text-[12.5px] text-ink-muted">
          <li className="flex gap-2">
            <span className="text-proof">✓</span>
            <span>
              {cov.green === 0 ? (
                'Every line traces to evidence you kept'
              ) : cov.complete ? (
                <>
                  <b className="font-semibold text-ink tabular-nums">{cov.green}</b>{' '}
                  {cov.green === 1 ? 'line' : 'lines'}, each traced to evidence you approved
                </>
              ) : (
                <>
                  <b className="font-semibold text-ink tabular-nums">{cov.traced}</b> of {cov.green} lines traced to approved
                  evidence
                </>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            {cov.complete ? (
              <>
                <span className="text-proof">✓</span> 0 unverifiable claims — only Kept evidence reaches the CV
              </>
            ) : (
              <>
                <span className="text-caution">⚐</span> {untraced} line{untraced === 1 ? '' : 's'} not yet traced to evidence
              </>
            )}
          </li>
          <li className="flex gap-2">
            <span className="text-proof">✓</span>{' '}
            {cov.selected ? (
              <>
                Chosen to fit the page — {leftOut} more kept {leftOut === 1 ? 'piece' : 'pieces'} ranked below the cut, on
                the Map
              </>
            ) : (
              'Within the 2-page budget'
            )}
          </li>
        </ul>
      </div>

      {/* Proof trail (M7) — the guarantee made demonstrable: click to show sources on every
          line. Each row: the graph ref_code it traces to, how it entered, and that you approved it.
          Computed from the Kept rows, never asserted. */}
      {cov.green > 0 && (
        <details className="group border-t border-hairline">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-[12px] font-semibold text-ink-muted transition hover:text-ink">
            <span className="text-ink-subtle transition group-open:rotate-90">▸</span>
            Show sources on every line ·{' '}
            {cov.complete ? `${cov.green} ${cov.green === 1 ? 'line' : 'lines'}, 100% traced` : `${cov.traced} of ${cov.green} traced`}
          </summary>
          <ul className="flex flex-col gap-2.5 border-t border-hairline bg-raised/50 px-5 py-3.5">
            {lines.map((r) => (
              <li key={r.id} className="flex items-start gap-3 text-[12px]">
                {r.shortlistRank != null && (
                  <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums text-ink-subtle">
                    {r.shortlistRank}
                  </span>
                )}
                {r.evidenceRef ? (
                  <span className="mt-0.5 shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-proof-deep ring-1 ring-inset ring-proof-ring">
                    {r.evidenceRef}
                  </span>
                ) : (
                  <span className="mt-0.5 shrink-0 rounded bg-caution-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-caution-deep ring-1 ring-inset ring-caution-ring">
                    no source
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{r.cvBullet ?? r.requirementLine ?? 'Requirement'}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-subtle">
                    <span className="rounded bg-surface px-1.5 py-0.5 font-semibold ring-1 ring-inset ring-hairline">
                      {SOURCE_LABEL[r.provSource] ?? 'Imported'}
                    </span>
                    {r.evidenceRef ? (
                      <span className="text-proof-deep">✓ approved by you{r.approvedAt ? ` · ${fmtApproved(r.approvedAt)}` : ''}</span>
                    ) : (
                      <span className="text-caution-deep">source pending</span>
                    )}
                  </span>
                  {(r.requirementSkills.length > 0 || r.mySkills.length > 0 || r.cvBulletSkills.length > 0) && (
                    <span className="mt-1 flex flex-col gap-1">
                      {r.requirementSkills.length > 0 && (
                        <SkillBadgeRow label="Asked for" tone="proof" items={r.requirementSkills} />
                      )}
                      {r.mySkills.length > 0 && <SkillBadgeRow label="My Skills" tone="neutral" items={r.mySkills} />}
                      {r.cvBulletSkills.length > 0 && (
                        <SkillBadgeRow label="On the bullet" tone="neutral" items={r.cvBulletSkills} />
                      )}
                      {/* No "not evidenced" badge yet — deliberately. The gap
                          (asked-for minus on-the-bullet) is the whole reason
                          C4's tag got its own column, but the only honest way to
                          compute it today is exact string match, and C4 rewords
                          almost every ask ("Stakeholder management" becomes
                          "Stakeholder Management With Senior Leadership"). That
                          scores 48 of 49 asks as missing on the Allianz lead,
                          nearly all of them false. A badge that fires on every
                          row teaches you to ignore it. Blocked on the wording
                          question in CI · Skill Name Treatment in the C4 Skills
                          Section; `scripts/audit-c4-skills-density.ts` prints
                          the literal comparison in the meantime, labelled for
                          what it is. */}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex gap-2.5 px-5 pb-5">
        <a
          href={`/api/cv/${c.lead.id}`}
          className="flex-[1.3] rounded-[9px] bg-ink px-4 py-3 text-center text-[13px] font-bold text-paper transition hover:opacity-90"
        >
          ↓ Download .docx
        </a>
        {!c.cvReady && (
          <button
            type="button"
            onClick={c.onGenerate}
            disabled={c.busy}
            className="flex-1 rounded-[9px] border border-hairline bg-surface px-4 py-3 text-[13px] font-bold text-ink transition hover:bg-raised disabled:opacity-60"
          >
            Generate
          </button>
        )}
      </div>
      {hasTrace(c, ['C3', 'C4', 'C5', 'C6', 'C7', 'C8']) && (
        <div className="border-t border-hairline px-5 py-3">
          <TraceDisclosure c={c} steps={['C3', 'C4', 'C5', 'C6', 'C7', 'C8']} />
        </div>
      )}
    </div>
  );
}

// ── interview brief (A1) ────────────────────────────────────────────────────
// A re-projection of what the lead already holds — the C2 evidence mapping + the
// JD requirements — into the *next* moment after the download: the interview.
// Nothing new is fetched or invented; it just reframes approved evidence as proof
// points to lead with, the must-haves to expect, and the thin spots to bridge
// honestly. Emits `interview_brief · open` (first expand) and `· print`, the
// reaction signal for whether the interview moment is the real emotional peak.
const WEAK_STRENGTHS = new Set(['Weak', 'No Match', 'Partial']);

function InterviewBrief({ c }: { c: Ctx }) {
  const [open, setOpen] = useState(false);
  const emitted = useRef(false);

  const proofPoints = c.rows
    .filter((r) => c.effective(r) === 'green' && (r.cvBullet ?? r.requirementLine))
    .map((r) => (r.cvBullet ?? r.requirementLine) as string)
    .slice(0, 4);
  const probes = c.requirements
    .filter((r) => r.rank === 'Core' || r.rank === 'Important')
    .map((r) => r.requirement)
    .slice(0, 5);
  const bridges = c.requirements
    .filter((r) => WEAK_STRENGTHS.has(r.initialMatchStrength ?? ''))
    .map((r) => r.requirement)
    .slice(0, 4);

  // Nothing to project yet (no kept evidence, no must-haves) — stay out of the way.
  if (proofPoints.length === 0 && probes.length === 0) return null;

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && !emitted.current) {
        emitted.current = true;
        void trackUxAction('interview_brief', 'open', c.lead.id);
      }
      return next;
    });
  }
  function onPrint() {
    void trackUxAction('interview_brief', 'print', c.lead.id);
    if (typeof window !== 'undefined') window.print();
  }

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-raised/50"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-proof-soft text-[15px] text-proof-deep">
          ✦
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">Prep for the interview</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
            {proofPoints.length} proof point{proofPoints.length === 1 ? '' : 's'} · {probes.length} likely probe
            {probes.length === 1 ? '' : 's'}
            {bridges.length > 0 ? ` · ${bridges.length} to pre-empt` : ''}
          </span>
        </span>
        <span className={cn('shrink-0 text-ink-subtle transition', open && 'rotate-90')}>▸</span>
      </button>

      {open && (
        <div className="border-t border-hairline px-5 py-4">
          <p className="mb-4 text-[12px] leading-relaxed text-ink-muted">
            Built from the evidence you kept and this role’s must-haves — nothing here is invented. Walk in ready to
            <b className="font-semibold text-ink"> lead with proof</b>, <b className="font-semibold text-ink">expect the
            probes</b>, and <b className="font-semibold text-ink">bridge the thin spots honestly</b>.
          </p>

          {proofPoints.length > 0 && (
            <BriefSection title="Lead with these — proof already on your CV" tone="proof">
              {proofPoints.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink">
                  <span className="mt-0.5 shrink-0 text-proof">✓</span>
                  <span>{p}</span>
                </li>
              ))}
            </BriefSection>
          )}

          {probes.length > 0 && (
            <BriefSection title="Expect to be pressed on" tone="ink">
              {probes.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-muted">
                  <span className="mt-0.5 shrink-0 text-ink-subtle">⌖</span>
                  <span>{p}</span>
                </li>
              ))}
            </BriefSection>
          )}

          {bridges.length > 0 && (
            <BriefSection title="Prepare an honest bridge for" tone="caution">
              {bridges.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-caution-deep">
                  <span className="mt-0.5 shrink-0">⚐</span>
                  <span>{p}</span>
                </li>
              ))}
            </BriefSection>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={onPrint}
              className="rounded-[9px] border border-hairline bg-surface px-4 py-2 text-[12px] font-bold text-ink transition hover:bg-raised"
            >
              ⎙ Print brief
            </button>
            <a
              href={`/roleproof/leads/${c.lead.id}/brief`}
              className="text-[12px] font-semibold text-proof-deep underline transition hover:text-proof"
            >
              Open the full night-before brief →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'proof' | 'ink' | 'caution';
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div
        className={cn(
          'mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
          tone === 'proof' && 'text-proof-deep',
          tone === 'ink' && 'text-ink-subtle',
          tone === 'caution' && 'text-caution-deep'
        )}
      >
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

// ── journey rail (2A, horizontal) ──────────────────────────────────────────────

function JourneyRail({ stages }: { stages: JourneyResult['stages'] }) {
  return (
    <div className="flex items-start rounded-card border border-hairline bg-surface px-4 py-3.5 shadow-card">
      {stages.map((s, i) => {
        const prevDone = i > 0 && stages[i - 1].state === 'done';
        return (
          <div key={s.key} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span
                className={cn(
                  'absolute right-1/2 top-[13px] h-0.5 w-full',
                  prevDone ? 'bg-proof' : 'bg-hairline'
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 grid h-[26px] w-[26px] place-items-center rounded-full text-[12px] font-semibold',
                s.state === 'done' && 'bg-proof text-white',
                s.state === 'current' && 'bg-surface text-proof shadow-[0_0_0_4px_rgba(19,122,91,.14)] ring-2 ring-proof',
                s.state === 'locked' && 'bg-raised text-ink-subtle ring-1 ring-hairline',
                s.state === 'upcoming' && 'bg-raised text-ink-subtle ring-1 ring-hairline'
              )}
            >
              {s.state === 'done' ? '✓' : s.state === 'locked' ? '🔒' : s.state === 'current' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-proof" />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                'mt-1.5 text-[10px] font-semibold',
                s.state === 'current' ? 'text-proof' : s.state === 'done' ? 'text-ink' : 'text-ink-subtle'
              )}
            >
              {s.label}
            </span>
            <CodeBadge code={s.steps} className="mt-1 bg-transparent px-0 text-ink-subtle" />
          </div>
        );
      })}
    </div>
  );
}

