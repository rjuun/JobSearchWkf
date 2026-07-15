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
import { runScreeningAction, promoteLeadAction, toggleTargetAction } from '@/app/actions/pipeline';
import { mapEvidenceAction, setApprovalAction, generateCvAction } from '@/app/actions/tailoring';
import { markAppliedAction } from '@/app/actions/monitoring';
import { addTipAction, resolveTipAction } from '@/app/actions/tips';
import { trackUxAction } from '@/app/actions/ux';
import type { JourneyResult } from '@/lib/journey';
import { provenanceCoverage } from '@/lib/provenance';
import { Mach, CodeBadge } from '@/components/machinery';
import { Frame } from '@/components/layout';
import { cn, RpStagePill, rpVerdict, scoreTone, SCORE_TEXT } from './kit';

export type RpLead = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  isTarget: boolean;
  jdGroupPrimary: string | null;
  atsSystem: string | null;
  sourceUrl: string | null;
  jobPostLink: string | null;
  overallFitScore: number | null;
  postedDays: number | null;
  freshnessBand: string | null;
  saturationBand: string | null;
  roadblocks: { dimension: string; detail: string }[];
  misalignments: { dimension: string; detail: string }[];
  skillRatings: Record<string, number>;
};
export type RpReq = {
  id: string;
  requirementOrder: number | null;
  rank: string | null;
  requirement: string;
  description: string | null;
  initialScore: number | null;
  initialMatchStrength: string | null;
};
export type RpRow = {
  id: string;
  requirementLine: string | null;
  evidenceRef: string | null;
  originalText: string | null;
  cvBullet: string | null;
  cvPosition: string | null;
  approvalStatus: string;
  provSource: string; // imported | coached | swapped
  approvedAt: string | null;
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
  jd: string | null;
  journey: JourneyResult;
  recommendation: string | null;
  dims: { label: string; value: number | null }[];
  cvReady: boolean;
  leadTips: { id: string; observation: string }[];
  runTrace: RunTrace[];
  /** Latest C7 ATS rating from the DB, so the score survives a reload. */
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
const TONE_TEXT: Record<string, string> = {
  proof: 'text-proof-deep',
  caution: 'text-caution-deep',
  drop: 'text-drop-deep',
  neutral: 'text-ink-muted',
};

type Ctx = {
  lead: RpLead;
  requirements: RpReq[];
  rows: RpRow[];
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
  current: RpRow | null;
  decided: number;
  total: number;
  kept: number;
  atsRating: number | null;
  busy: boolean;
  busyPhase: 'map' | 'generate' | null;
  busyStep: number;
  canUndo: boolean;
  onScreen: () => void;
  onPromote: () => void;
  onMap: () => void;
  onVote: (status: 'green' | 'yellow' | 'red') => void;
  onUndo: () => void;
  onGenerate: () => void;
  onApply: () => void;
};

export function RpWorkspace(props: Props) {
  const { lead, requirements, tailoring, jd, journey, recommendation, cvReady } = props;
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [running, setRunning] = useState(false);
  const [runStep, setRunStep] = useState(0);
  const [showMaths, setShowMaths] = useState(false);
  const [overlay, setOverlay] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [atsRating, setAtsRating] = useState<number | null>(props.initialAtsRating);
  const [error, setError] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<'map' | 'generate' | null>(null);
  const [busyStep, setBusyStep] = useState(0);
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
  const current = tailoring.find((r) => effective(r) === 'pending') ?? null;
  const decided = tailoring.filter((r) => effective(r) !== 'pending').length;
  const kept = tailoring.filter((r) => effective(r) === 'green').length;

  function onScreen() {
    if (running) return;
    setError(null);
    setRunning(true);
    setRunStep(0);
    intervalRef.current = setInterval(() => setRunStep((s) => Math.min(s + 1, 5)), 600);
    (async () => {
      try {
        await runScreeningAction(lead.id);
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
  function onVote(status: 'green' | 'yellow' | 'red') {
    if (!current) return;
    const id = current.id;
    if (status === 'green' && !current.cvPosition) {
      setError('This evidence needs a valid CV template slot before it can be kept.');
      return;
    }
    const previous = effective(current);
    setOverlay((o) => ({ ...o, [id]: status }));
    setHistory((h) => [...h, id]);
    startTransition(async () => {
      try {
        setError(null);
        await setApprovalAction(id, status, lead.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setOverlay((o) => ({ ...o, [id]: previous }));
        setHistory((h) => h.filter((entry) => entry !== id));
      } finally {
        router.refresh();
      }
    });
  }
  function onUndo() {
    const id = history[history.length - 1];
    if (!id) return;
    setHistory((h) => h.slice(0, -1));
    setOverlay((o) => ({ ...o, [id]: 'pending' }));
    startTransition(async () => {
      await setApprovalAction(id, 'pending', lead.id);
      router.refresh();
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
  function onApply() {
    startTransition(async () => {
      try {
        setError(null);
        await markAppliedAction(lead.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
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
    current,
    decided,
    total: tailoring.length,
    kept,
    atsRating,
    busy,
    busyPhase,
    busyStep,
    canUndo: history.length > 0,
    onScreen,
    onPromote,
    onMap,
    onVote,
    onUndo,
    onGenerate,
    onApply,
  };

  return <TwoPane c={c} />;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const PROMPT_SOURCE: Record<string, string> = {
  B1: 'code rule',
  B2: 'Process/B2',
  B3: 'Process/B3',
  B4: 'Process/B4',
  B5: 'Process/B5',
  B6: 'Process/B6',
  C1: 'code rule',
  C2: 'Process/C2',
  C3: 'Process/C3',
  C4: 'code rule',
  C5: 'Process/C5',
  C6: 'DOCX template',
  C7: 'Process/C7',
};

function tracesFor(c: Ctx, steps: string[]): RunTrace[] {
  return steps.map((step) => c.runTrace.find((run) => run.step === step)).filter((run): run is RunTrace => !!run);
}

function hasTrace(c: Ctx, steps: string[]): boolean {
  return steps.some((step) => c.runTrace.some((run) => run.step === step));
}

function hasMappableRequirements(c: Ctx): boolean {
  return c.requirements.some((r) => r.rank === 'Core' || r.rank === 'Important');
}

function compactCvSlot(value: string): string {
  return value.match(/[A-D][0-9]/)?.[0] ?? value;
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

function TraceDisclosure({ c, steps, dark = false }: { c: Ctx; steps: string[]; dark?: boolean }) {
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
        <span className="font-mono text-[10px] opacity-70">{runs.length}/{steps.length}</span>
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

const CHECK_QS = [
  'Is this still worth chasing?',
  'Any dealbreakers?',
  'Where might you fall short?',
  'Which of your skills line up?',
  'What are the must-haves?',
  'Overall, is it worth your time?',
];
// The methodology step behind each plain-language check (shown in machinery mode).
const SCREEN_CODES = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

function buildChecks(c: Ctx): { q: string; a: string; tone: string; list?: string[] }[] {
  const { lead, requirements } = c;
  const skills = Object.keys(lead.skillRatings ?? {}).length;
  const rb = lead.roadblocks ?? [];
  const mis = lead.misalignments ?? [];
  return [
    {
      q: CHECK_QS[0],
      a:
        lead.postedDays != null
          ? `${lead.postedDays} day${lead.postedDays === 1 ? '' : 's'} old — ${lead.freshnessBand ?? 'within the window'}`
          : lead.freshnessBand ?? 'Fresh enough to pursue',
      tone: 'proof',
    },
    {
      q: CHECK_QS[1],
      a:
        rb.length === 0
          ? 'None found — nothing hard blocks you.'
          : rb.length === 1
            ? rb[0].detail || rb[0].dimension
            : `${rb.length} potential blockers`,
      list: rb.length > 1 ? rb.map((r) => r.detail || r.dimension) : undefined,
      tone: rb.length ? 'drop' : 'proof',
    },
    {
      q: CHECK_QS[2],
      a:
        mis.length === 0
          ? 'Nothing major stands out.'
          : mis.length === 1
            ? `${mis[0].dimension ? `${mis[0].dimension}: ` : ''}${mis[0].detail}`
            : `${mis.length} to weigh`,
      list:
        mis.length > 1
          ? mis.map((m) => `${m.dimension ? `${m.dimension}: ` : ''}${m.detail}`)
          : undefined,
      tone: mis.length ? 'caution' : 'proof',
    },
    {
      q: CHECK_QS[3],
      a: skills ? `${skills} of your skills line up with the role` : 'Skills compared to your history',
      tone: 'proof',
    },
    {
      q: CHECK_QS[4],
      a: requirements.length
        ? `${requirements.length} must-haves read & ranked`
        : 'Requirements read from the posting',
      tone: 'neutral',
    },
    {
      q: CHECK_QS[5],
      a: `${rpVerdict(lead.overallFitScore)} · ${lead.overallFitScore?.toFixed(1)} / 10`,
      tone: scoreTone(lead.overallFitScore),
    },
  ];
}

// ── layout: 2A two-pane command center ─────────────────────────────────────────

function TwoPane({ c }: { c: Ctx }) {
  return (
    <Frame className="pt-5 pb-24">
      <LeadHeader c={c} />
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]">
        {/* LEFT · JD reader, pinned */}
        <div className="lg:sticky lg:top-[74px]">
          <JdReader jd={c.jd} requirements={c.requirements} skillRatings={c.lead.skillRatings} />
        </div>
        {/* RIGHT · work rail */}
        <div className="flex flex-col gap-4">
          {c.scored ? <ScoreCard c={c} /> : c.isHold ? <HeldCard c={c} /> : <RunCard c={c} />}
          <ActionError c={c} />
          {c.scored && <JourneyRail stages={c.journey.stages} />}
          {!c.running && !c.busyPhase && c.journey.next.cta !== 'none' && <NextMove c={c} />}
          {c.scored && c.screenStage && <ChecksCard c={c} />}
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
              <TriageCard c={c} />
            ))}
          {c.scored && <EnrichBar c={c} />}
        </div>
      </div>
    </Frame>
  );
}

// ── shared header ──────────────────────────────────────────────────────────────

function LeadHeader({ c }: { c: Ctx }) {
  const { lead } = c;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          {[lead.company, lead.city].filter(Boolean).join(' · ') || 'Job lead'}
        </div>
        <h1 className="mt-1 font-serif text-[34px] leading-tight text-ink">{lead.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RpStagePill status={lead.status} />
          {lead.jdGroupPrimary && <Chip>{lead.jdGroupPrimary}</Chip>}
          {lead.atsSystem && <Chip>ATS · {lead.atsSystem}</Chip>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TargetToggle leadId={lead.id} initial={lead.isTarget} />
        {lead.sourceUrl && <PostingLink href={lead.sourceUrl}>LinkedIn</PostingLink>}
        {lead.jobPostLink && <PostingLink href={lead.jobPostLink}>Company posting</PostingLink>}
      </div>
    </div>
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-raised px-3 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-inset ring-hairline">
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

// ── JD reader (tabbed) ───────────────────────────────────────────────────────

const SKILL_RANK_WORD: Record<number, string> = { 1: 'Core', 2: 'Important', 3: 'Supporting' };
const SKILL_RANK_PILL: Record<number, string> = {
  1: 'bg-proof-soft text-proof-deep',
  2: 'bg-caution-soft text-caution-deep',
  3: 'bg-raised text-ink-muted',
};

function JdReader({
  jd,
  requirements,
  skillRatings,
  flat,
}: {
  jd: string | null;
  requirements: RpReq[];
  skillRatings: Record<string, number>;
  flat?: boolean;
}) {
  const [tab, setTab] = useState<'role' | 'reqs' | 'skills'>('role');
  const skillEntries = Object.entries(skillRatings).sort((a, b) => a[1] - b[1]);
  const body = (
    <>
      <div className="flex gap-1 border-b border-hairline px-4 pt-2">
        <TabBtn active={tab === 'role'} onClick={() => setTab('role')}>
          The role
        </TabBtn>
        <TabBtn active={tab === 'reqs'} onClick={() => setTab('reqs')}>
          Must-haves <span className="font-mono text-[11px]">{requirements.length}</span>
        </TabBtn>
        <TabBtn active={tab === 'skills'} onClick={() => setTab('skills')}>
          Skills <span className="font-mono text-[11px]">{skillEntries.length}</span>
        </TabBtn>
      </div>

      {tab === 'role' && (
        <div className="px-5 py-5">
          {jd ? (
            <p className="whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-muted">{jd.trim()}</p>
          ) : (
            <p className="text-sm text-ink-subtle">The posting text hasn’t been captured for this lead.</p>
          )}
        </div>
      )}

      {tab === 'reqs' && (
        <div className="px-3 py-2">
          {requirements.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-subtle">
              No must-haves extracted yet — screen the role first.
            </p>
          ) : (
            <ul className="divide-y divide-hairline/70">
              {requirements.map((r) => {
                const gap = r.initialMatchStrength === 'No Match' || (r.initialScore ?? 10) < 4;
                return (
                  <li key={r.id} className="flex items-start gap-3 px-2 py-2.5">
                    <span
                      className={cn(
                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-inset',
                        gap ? 'bg-caution-soft ring-caution-ring' : 'bg-proof-soft ring-proof-ring'
                      )}
                      title={gap ? 'a gap to address' : 'you can evidence this'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-ink">{r.requirement}</div>
                      {r.description && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-subtle">
                          {r.description}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
                        {r.rank && <span className="font-semibold uppercase tracking-wide">{r.rank}</span>}
                        {r.initialMatchStrength && <span>· {r.initialMatchStrength}</span>}
                      </div>
                    </div>
                    {r.initialScore != null && (
                      <span
                        className={cn(
                          'shrink-0 font-serif text-[18px] leading-none tabular-nums',
                          SCORE_TEXT[scoreTone(r.initialScore)]
                        )}
                        title="how well your evidence matches"
                      >
                        {r.initialScore.toFixed(1)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'skills' && (
        <div className="px-3 py-3">
          {skillEntries.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-subtle">
              No skills read yet — screen the role first.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-3 px-2 text-[10px] text-ink-subtle">
                {(
                  [
                    ['Core', 'bg-proof'],
                    ['Important', 'bg-caution'],
                    ['Supporting', 'bg-ink-subtle'],
                  ] as const
                ).map(([label, dot]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', dot)} /> {label}
                  </span>
                ))}
              </div>
              <ul className="grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
                {skillEntries.map(([name, rating]) => (
                  <li key={name} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="truncate text-[12.5px] text-ink-muted">{name}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        SKILL_RANK_PILL[rating] ?? SKILL_RANK_PILL[3]
                      )}
                    >
                      {SKILL_RANK_WORD[rating] ?? 'Supporting'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'reqs' && (
        <div className="flex items-center gap-4 border-t border-hairline px-5 py-2.5 text-[11px] text-ink-subtle">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-proof-soft ring-1 ring-inset ring-proof-ring" /> you can
            evidence this
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-caution-soft ring-1 ring-inset ring-caution-ring" /> a gap
            to address
          </span>
        </div>
      )}
    </>
  );
  if (flat) return <div className="overflow-hidden rounded-[10px] border border-hairline bg-surface">{body}</div>;
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      {body}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2 text-[12px] font-semibold transition',
        active ? 'border-proof text-ink' : 'border-transparent text-ink-subtle hover:text-ink-muted'
      )}
    >
      {children}
    </button>
  );
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

function ChecksCard({ c }: { c: Ctx }) {
  const checks = c.running ? null : buildChecks(c);
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-hairline bg-raised px-4 py-3">
        <span className={cn('h-2.5 w-2.5 rounded-full', c.running ? 'bg-caution' : 'bg-proof')} />
        <span className="text-[13px] font-semibold text-ink">
          {c.running ? 'Screening — reading the posting' : 'How RoleProof checked'}
        </span>
        <span className="ml-auto text-[11px] font-semibold text-ink-subtle">
          {c.running ? `step ${Math.min(c.runStep + 1, 6)} of 6` : '6 plain-English checks'}
        </span>
      </div>
      <div className="p-1.5">
        {CHECK_QS.map((q, i) => {
          const done = c.running ? i < c.runStep : true;
          const isRun = c.running && i === c.runStep;
          const ans = checks?.[i];
          return (
            <div
              key={q}
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
                  {q} <CodeBadge code={SCREEN_CODES[i] ?? ''} />
                </div>
                <div className={cn('mt-0.5 text-[12px] leading-snug', ans ? TONE_TEXT[ans.tone] : 'text-ink-subtle')}>
                  {ans ? ans.a : isRun ? 'thinking…' : 'up next'}
                </div>
                {ans?.list && (
                  <ul className="mt-1 space-y-0.5">
                    {ans.list.map((it, j) => (
                      <li key={j} className="flex gap-1.5 text-[11px] text-ink-muted">
                        <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* B → Coach bridge: shown only when an OPEN screening-gap prompt
                    actually exists for this lead, so the CTA can never dead-end. */}
                {i === 2 && !c.running && c.coachBridge && (
                  <Link
                    href={`/profile/coach?lead=${c.lead.id}`}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-[7px] bg-proof px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-proof-deep"
                  >
                    + Add the evidence with your coach →
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-hairline px-4 py-2.5 text-[11px] text-ink-subtle">
        RoleProof reads the posting and compares it to your history · stop anytime
      </div>
      {hasTrace(c, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) && (
        <div className="border-t border-hairline px-4 py-3">
          <TraceDisclosure c={c} steps={['B1', 'B2', 'B3', 'B4', 'B5', 'B6']} />
        </div>
      )}
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
          <TraceDisclosure c={c} steps={['B1', 'B2', 'B3', 'B4', 'B5', 'B6']} dark />
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
      <span className="flex shrink-0 items-center gap-2">
        <a href={`/api/cv/${c.lead.id}`} className={cls}>
          Download
        </a>
        <button onClick={c.onApply} className={cn(cls, 'bg-white/15 text-white hover:bg-white/25')}>
          Mark applied
        </button>
      </span>
    );
  const map: Partial<Record<string, () => void>> = {
    screen: c.onScreen,
    promote: c.onPromote,
    map: hasMappableRequirements(c) ? c.onMap : c.onScreen,
    generate: c.onGenerate,
  };
  const labels: Partial<Record<string, string>> = {
    screen: 'Screen',
    promote: 'Promote',
    map: hasMappableRequirements(c) ? 'Map' : 'Extract must-haves',
    generate: 'Generate',
    approve: 'Review',
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
        {hasTrace(c, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) && (
          <div className="mt-4">
            <TraceDisclosure c={c} steps={['B1', 'B2', 'B3', 'B4', 'B5', 'B6']} />
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
      {hasTrace(c, ['C1', 'C2']) && (
        <div className="mt-4">
          <TraceDisclosure c={c} steps={['C1', 'C2']} />
        </div>
      )}
    </div>
  );
}

function TriageCard({ c }: { c: Ctx }) {
  const cur = c.current;
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      {/* progress strip */}
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="text-[12px] text-ink-muted">
          Evidence <b className="text-ink">{c.decided}</b> / {c.total}
        </span>
        <div className="flex flex-1 gap-1">
          {c.rows.map((r) => {
            const v = c.effective(r);
            const color =
              v === 'green'
                ? 'bg-proof'
                : v === 'yellow'
                  ? 'bg-caution'
                  : v === 'red'
                    ? 'bg-drop'
                    : cur && r.id === cur.id
                      ? 'bg-ink'
                      : 'bg-hairline';
            return <span key={r.id} className={cn('h-[5px] flex-1 rounded-sm', color)} />;
          })}
        </div>
        <button
          type="button"
          onClick={c.onUndo}
          disabled={!c.canUndo || c.busy}
          className={cn('text-[11px] font-semibold', c.canUndo ? 'text-proof' : 'text-ink-subtle')}
        >
          ↩ Undo
        </button>
        <button
          type="button"
          onClick={c.onMap}
          disabled={c.busy}
          className="text-[11px] font-medium text-ink-subtle transition hover:text-ink-muted disabled:opacity-50"
        >
          Re-map
        </button>
      </div>
      {hasTrace(c, ['C1', 'C2']) && (
        <div className="border-b border-hairline px-4 py-3">
          <TraceDisclosure c={c} steps={['C1', 'C2']} />
        </div>
      )}

      {cur ? (
        <>
          <div className="px-5 pt-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
              {c.kept} kept so far
            </div>
            <div className="mt-1 font-serif text-[21px] leading-snug text-ink">
              {cur.requirementLine ?? 'This requirement'}
            </div>
            <div className="mt-4 rounded-[10px] border border-hairline bg-raised p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold text-ink-subtle">From your history</span>
                {cur.evidenceRef && (
                  <span className="rounded-[5px] bg-paper px-2 py-0.5 font-mono text-[10px] text-ink-muted ring-1 ring-inset ring-hairline">
                    {cur.evidenceRef}
                  </span>
                )}
                {cur.cvPosition ? (
                  <span className="rounded-[5px] bg-proof-soft px-2 py-0.5 text-[10px] font-semibold text-proof-deep ring-1 ring-inset ring-proof/20">
                    Slot {compactCvSlot(cur.cvPosition)}
                  </span>
                ) : (
                  <span className="rounded-[5px] bg-caution-soft px-2 py-0.5 text-[10px] font-semibold text-caution-deep ring-1 ring-inset ring-caution/25">
                    Needs CV slot
                  </span>
                )}
              </div>
              <div className="text-[13.5px] leading-relaxed text-ink">
                {cur.originalText ?? 'Evidence from your career graph.'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.3fr] gap-2.5 px-5 pb-2 pt-4">
            <VoteBtn tone="drop" disabled={c.busy} onClick={() => c.onVote('red')}>
              Drop
            </VoteBtn>
            <VoteBtn tone="caution" disabled={c.busy} onClick={() => c.onVote('yellow')}>
              Maybe
            </VoteBtn>
            <VoteBtn tone="proof" disabled={c.busy || !cur.cvPosition} onClick={() => c.onVote('green')}>
              Keep
            </VoteBtn>
          </div>
          <p className="px-5 pb-5 pt-1 text-center text-[11px] text-ink-subtle">
            Only “Keep” reaches your CV — the system won’t claim anything you haven’t kept.
          </p>
        </>
      ) : (
        <div className="px-5 py-8 text-center">
          <div className="font-serif text-[24px] text-ink">{c.kept} pieces kept</div>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-ink-muted">
            Every one is something you can defend in an interview. Ready to assemble the CV.
          </p>
          <button
            type="button"
            onClick={c.onGenerate}
            disabled={c.busy || c.kept === 0}
            className="mt-4 rounded-[10px] bg-proof px-6 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
          >
            {c.busy ? 'Assembling…' : 'Generate CV →'}
          </button>
        </div>
      )}
    </div>
  );
}

// Animated progress while the live C-pipeline runs (map: C1–C2, generate: C3–C7).
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

function VoteBtn({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: 'proof' | 'caution' | 'drop';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const styles = {
    proof: 'bg-proof text-white shadow-[0_2px_8px_-2px_rgba(19,122,91,.5)] hover:bg-proof-deep',
    caution: 'border border-caution-ring bg-caution-soft text-caution-deep hover:bg-caution-soft/70',
    drop: 'border border-drop-ring bg-drop-soft text-drop-deep hover:bg-drop-soft/70',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('rounded-[10px] py-3 text-[13px] font-bold transition disabled:opacity-60', styles)}
    >
      {children}
    </button>
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
  // Provenance is computed, not asserted. `green` = every line that reaches the CV
  // (the generator uses all Kept rows); the ledger shows each with its ref, and flags
  // any that don't yet trace — so the summary can never overclaim.
  const green = c.rows.filter((r) => c.effective(r) === 'green');
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
              C3 draft · C4 skills · C5 profile · C6 compile · C7 ATS rating
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
            <span className="text-proof">✓</span> Within the 2-page budget
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
            {green.map((r) => (
              <li key={r.id} className="flex items-start gap-3 text-[12px]">
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
      {hasTrace(c, ['C3', 'C4', 'C5', 'C6', 'C7']) && (
        <div className="border-t border-hairline px-5 py-3">
          <TraceDisclosure c={c} steps={['C3', 'C4', 'C5', 'C6', 'C7']} />
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

