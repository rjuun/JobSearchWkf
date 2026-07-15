'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from './ui';
import { draftAnswerAction, approveAnswerAction, skipPromptAction, undoApprovalAction } from '@/app/actions/coaching';
import { trackUxAction } from '@/app/actions/ux';
import type { QueueGroup, QueueItem, PromptSource, ExcavationInvite } from '@/lib/coaching-queue';
import type { StrengthComponent } from '@/lib/career-graph';

/** A bounded session: aim for a few high-value captures, then a designed stop. */
const SESSION_TARGET = 3;

const SOURCE_GLYPH: Record<PromptSource, string> = {
  prior_roles: '↑',
  target_requirements: '⌖',
  similar_resumes: '≈',
  screening_gap: '⚑',
  excavation: '⛏',
  seed: '✦',
};

const SAMPLE =
  'I owned the group operating budget — about €210M — and reset how it was allocated across the regions, which tightened our forecast accuracy and freed funding for the transformation.';

type Props = {
  groups: QueueGroup[];
  strength: number;
  ceiling: number;
  headroom: number;
  label: string;
  components: StrengthComponent[];
  openCount: number;
  invites?: ExcavationInvite[];
  fromRole?: string | null;
  warmup?: boolean;
};

export function CoachQueue(props: Props) {
  const { groups, strength, ceiling, headroom, label, components, openCount, invites = [], fromRole = null, warmup = false } = props;
  const router = useRouter();

  // R2 · excavation invitations live beside the ranked queue. They only enter the
  // working set once *accepted* — never auto-advanced into the stage — and are hidden
  // for the session when snoozed (they return next visit). `stageRef` lets an accept
  // scroll the stage into view.
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const acceptedInvites = useMemo(() => invites.filter((i) => acceptedIds.has(i.id)), [invites, acceptedIds]);
  const visibleInvites = useMemo(
    () => invites.filter((i) => !acceptedIds.has(i.id) && !snoozedIds.has(i.id)),
    [invites, acceptedIds, snoozedIds]
  );

  // Value-ordered flat list (groups + items are already value-sorted server-side),
  // plus any excavation invite the user has explicitly taken up.
  const flat = useMemo(() => [...groups.flatMap((g) => g.items), ...acceptedInvites], [groups, acceptedInvites]);

  const [actedIds, setActedIds] = useState<Set<string>>(new Set());
  const [captured, setCaptured] = useState<{ id: string; question: string; source: PromptSource }[]>([]);
  const [activeId, setActiveId] = useState<string | null>(flat[0]?.id ?? null);
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const [extended, setExtended] = useState(false); // user chose to keep going past the set
  const [toast, setToast] = useState<{ promptId: string; question: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session baseline strength — captured once so the "+N" tally is stable across refreshes.
  const startStrength = useRef(strength);
  const gained = Math.max(0, strength - startStrength.current);

  const remaining = useMemo(() => flat.filter((i) => !actedIds.has(i.id)), [flat, actedIds]);
  const active = useMemo(
    () => flat.find((i) => i.id === activeId) ?? remaining[0] ?? null,
    [flat, activeId, remaining]
  );

  const showToast = useCallback((t: { promptId: string; question: string }) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, []);
  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  function openStage(id: string) {
    setActiveId(id);
    setAnswer('');
    setEditing(false);
  }

  /** Auto-advance: load the next-most-valuable un-acted prompt into the stage. */
  function advanceFrom(justActedId: string) {
    const next = remaining.find((i) => i.id !== justActedId);
    setAnswer('');
    setEditing(false);
    setActiveId(next ? next.id : null);
  }

  function runDraft() {
    if (!active || answer.trim().length < 3) return;
    const fd = new FormData();
    fd.set('promptId', active.id);
    fd.set('rawAnswer', answer);
    start(async () => {
      await draftAnswerAction(fd);
      setEditing(false);
      router.refresh();
    });
  }

  function approve() {
    if (!active) return;
    const cur = active;
    const fd = new FormData();
    fd.set('promptId', cur.id);
    start(async () => {
      const res = await approveAnswerAction(fd);
      if (!res.ok) {
        // A double-click or a stale click: nothing was committed. Say so, sync, don't advance.
        showNotice(res.reason === 'nodraft' ? 'Draft the evidence first — nothing to approve yet.' : 'Already approved.');
        router.refresh();
        return;
      }
      setActedIds((s) => new Set(s).add(cur.id));
      setCaptured((c) => [{ id: cur.id, question: cur.question, source: cur.promptSource }, ...c]);
      showToast({ promptId: cur.id, question: cur.question });
      advanceFrom(cur.id);
      router.refresh();
    });
  }

  function skip() {
    if (!active) return;
    const cur = active;
    const fd = new FormData();
    fd.set('promptId', cur.id);
    start(async () => {
      await skipPromptAction(fd);
      setActedIds((s) => new Set(s).add(cur.id));
      advanceFrom(cur.id);
      router.refresh();
    });
  }

  function undo(promptId: string) {
    const fd = new FormData();
    fd.set('promptId', promptId);
    setToast(null);
    start(async () => {
      await undoApprovalAction(fd);
      setActedIds((s) => {
        const n = new Set(s);
        n.delete(promptId);
        return n;
      });
      setCaptured((c) => c.filter((x) => x.id !== promptId));
      openStage(promptId);
      router.refresh();
    });
  }

  const capturedCount = captured.length;
  const sessionComplete = capturedCount >= SESSION_TARGET && !extended;

  // A2 reaction signal: the designed stop is the thing we're testing — does a
  // bounded 3-prompt session complete more often than today's open-ended queue
  // gets abandoned? Emit once when the stop card first appears; emit keep_going
  // when a power user opts back into the infinite behaviour.
  const stopEmitted = useRef(false);
  useEffect(() => {
    if (sessionComplete && !stopEmitted.current) {
      stopEmitted.current = true;
      void trackUxAction('coach_session', 'session_complete');
    }
  }, [sessionComplete]);
  const keepGoing = useCallback(() => {
    void trackUxAction('coach_session', 'keep_going');
    setExtended(true);
  }, []);

  // R2 · reaction signal. `shown` fires once when an invitation is first on screen —
  // the denominator for whether invitations earn their place or the meter alone carries
  // rediscovery. `accepted`/`snoozed` are the two responses.
  const invitesShown = useRef(false);
  useEffect(() => {
    if (visibleInvites.length > 0 && !invitesShown.current) {
      invitesShown.current = true;
      void trackUxAction('excavation', 'shown');
    }
  }, [visibleInvites.length]);

  function acceptInvite(inv: ExcavationInvite) {
    void trackUxAction('excavation', 'accepted');
    setExtended(true); // an explicit "take me back" is an intent to keep working
    setAcceptedIds((s) => new Set(s).add(inv.id));
    openStage(inv.id);
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function snoozeInvite(inv: ExcavationInvite) {
    // "Not now" is a genuine snooze, not a dismissal: hide it for this session only and let
    // it return on the next visit. Rediscovery is the whole point — a thin era stays worth
    // revisiting, so one deferral never skips it out of existence. (The prompt stays `open`;
    // generatePrompts dedupes on its key, so nothing duplicates.)
    void trackUxAction('excavation', 'snoozed');
    setSnoozedIds((s) => new Set(s).add(inv.id));
  }

  // ── Empty / caught-up ──────────────────────────────────────────────────────
  // Only short-circuit when there's no ranked work AND nothing taken up yet — an
  // accepted invitation lives in `flat`, so it falls through to the stage below.
  if (openCount === 0 && capturedCount === 0 && flat.length === 0) {
    return (
      <div className="animate-fade-in">
        <Header strength={strength} label={label} />
        {warmup && <WarmupNudge />}
        <CaughtUp />
        {visibleInvites.length > 0 && (
          <ExcavationInvites invites={visibleInvites} onAccept={acceptInvite} onSnooze={snoozeInvite} pending={pending} />
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <Header strength={strength} label={label} />
      {warmup && <WarmupNudge />}
      {fromRole && (
        <div className="mt-4 flex items-center gap-2.5 rounded-card border border-proof-ring bg-proof-soft/50 px-4 py-3 text-[13px]">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-proof text-white">⌖</span>
          <span className="text-ink-muted">
            From the screening of <b className="font-semibold text-proof-deep">{fromRole}</b> — the prompts below turn that
            watch-out into evidence.
          </span>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ── Rail ── */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[74px] lg:self-start">
          <StrengthCard strength={strength} ceiling={ceiling} headroom={headroom} label={label} components={components} />
          <SessionTally captured={captured} gained={gained} onUndo={undo} pending={pending} />
          <UpNext items={remaining.filter((i) => i.id !== active?.id)} onOpen={openStage} />
        </aside>

        {/* ── Stage ── */}
        <section ref={stageRef} className="min-w-0 scroll-mt-[74px]">
          {sessionComplete ? (
            <StopCard captured={captured} gained={gained} hasMore={remaining.length > 0} onKeepGoing={keepGoing} />
          ) : active ? (
            <Stage
              item={active}
              answer={answer}
              setAnswer={setAnswer}
              editing={editing}
              setEditing={setEditing}
              pending={pending}
              position={capturedCount + 1}
              target={SESSION_TARGET}
              onDraft={runDraft}
              onApprove={approve}
              onSkip={skip}
              onSample={() => setAnswer(SAMPLE)}
            />
          ) : (
            <CaughtUp inSession={capturedCount > 0} gained={gained} />
          )}
        </section>
      </div>

      {visibleInvites.length > 0 && (
        <ExcavationInvites invites={visibleInvites} onAccept={acceptInvite} onSnooze={snoozeInvite} pending={pending} />
      )}

      {toast && <UndoToast question={toast.question} onUndo={() => undo(toast.promptId)} onDismiss={() => setToast(null)} />}
      {notice && <NoticeToast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}

// ── R2 · Excavation invitations ──────────────────────────────────────────────
// Surfaced *below* the ranked queue, never in the stage: rediscovery is optional
// and must never queue ahead of real work. Each card names a specific thin era and
// offers to take you back to it — or defer with "not now".

function ExcavationInvites({
  invites,
  onAccept,
  onSnooze,
  pending,
}: {
  invites: ExcavationInvite[];
  onAccept: (inv: ExcavationInvite) => void;
  onSnooze: (inv: ExcavationInvite) => void;
  pending: boolean;
}) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">When you have a quiet moment</span>
        <span className="text-[11px] text-ink-subtle">— rediscovery, never ahead of your queue</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {invites.map((inv) => (
          <div key={inv.id} className="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-caution-soft text-[15px] text-caution-deep">
                ⛏
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {inv.era ?? 'A thin era'}
                  {inv.company ? ` · ${inv.company}` : ''}
                </div>
                <div className="mt-1 text-[13.5px] leading-snug text-ink">{inv.question}</div>
                {inv.why && <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">{inv.why}</div>}
              </div>
            </div>
            <div className="mt-auto flex items-center gap-2 border-t border-hairline px-4 py-2.5">
              <button
                onClick={() => onAccept(inv)}
                disabled={pending}
                className="rounded-field bg-ink px-3.5 py-2 text-[12px] font-bold text-paper transition hover:opacity-90 disabled:opacity-50"
              >
                Take me back →
              </button>
              <button
                onClick={() => onSnooze(inv)}
                disabled={pending}
                className="ml-auto text-[12px] font-semibold text-ink-subtle transition hover:text-ink disabled:opacity-50"
              >
                Not now
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A plain, self-dismissing message (no action) — used for approve no-ops (double/stale clicks). */
function NoticeToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="flex max-w-[420px] items-center gap-3 rounded-full border border-hairline bg-surface px-4 py-2.5 text-ink shadow-lg animate-fade-in">
        <span className="text-caution">⚐</span>
        <span className="line-clamp-1 text-[13px]">{message}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-ink-subtle transition hover:text-ink">
          ✕
        </button>
      </div>
    </div>
  );
}

/** No-job-ad path (M5): after warming up from a CV, nudge toward the real first win. */
function WarmupNudge() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-card border border-proof-ring bg-proof-soft/50 px-4 py-3 text-[13px]">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-proof text-white">✦</span>
      <span className="text-ink-muted">
        Your Career Graph has shape now. Answer a couple of these, then{' '}
        <a href="/roleproof/capture" className="font-semibold text-proof-deep underline">
          paste a real role
        </a>{' '}
        to see a Role-Fit verdict and tailor a CV.
      </span>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ strength, label }: { strength: number; label: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Career Graph · enrich</div>
        <h1 className="mt-1 font-serif text-[36px] leading-none text-ink">Your coach</h1>
        <p className="mt-2 max-w-[54ch] text-sm text-ink-muted">
          A short, focused set — answer one, approve, and the next-most-valuable question loads itself.
        </p>
      </div>
      <div className="shrink-0 text-right lg:hidden">
        <div className="font-serif text-[34px] leading-none text-proof">{strength}</div>
        <div className="text-[11px] font-semibold text-proof-deep">{label}</div>
      </div>
    </div>
  );
}

// ── Rail pieces ────────────────────────────────────────────────────────────────

function StrengthCard({
  strength,
  ceiling,
  headroom,
  label,
  components,
}: {
  strength: number;
  ceiling: number;
  headroom: number;
  label: string;
  components: StrengthComponent[];
}) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">Graph strength</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-serif text-[40px] leading-none text-proof tabular-nums">{strength}</span>
        <span className="text-[13px] text-ink-subtle">/ 100</span>
        <span className="ml-auto text-[11px] font-semibold text-proof-deep">{label}</span>
      </div>
      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="absolute inset-y-0 left-0 rounded-full bg-proof-soft" style={{ width: `${ceiling}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-proof transition-[width] duration-700 ease-out-soft" style={{ width: `${strength}%` }} />
      </div>
      <div className="mt-1.5 text-[10.5px] text-ink-subtle">{headroom} points of headroom</div>
      <div className="mt-3 flex flex-col gap-1.5">
        {components.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-[10.5px]">
            <span className="w-[92px] shrink-0 truncate text-ink-muted">{c.label}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
              <span className={cn('block h-full rounded-full', c.locked ? 'bg-caution' : 'bg-proof')} style={{ width: `${c.max ? (c.earned / c.max) * 100 : 0}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionTally({
  captured,
  gained,
  onUndo,
  pending,
}: {
  captured: { id: string; question: string; source: PromptSource }[];
  gained: number;
  onUndo: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-card border border-hairline bg-raised px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">This session</span>
        <span className="text-[12px] font-semibold text-ink">
          {captured.length} captured{gained > 0 && <span className="text-proof"> · +{gained}</span>}
        </span>
      </div>
      {captured.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {captured.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-[11.5px] text-ink-muted">
              <span className="text-proof">✓</span>
              <span className="line-clamp-1 flex-1">{c.question}</span>
              <button onClick={() => onUndo(c.id)} disabled={pending} className="shrink-0 font-semibold text-ink-subtle transition hover:text-ink disabled:opacity-50">
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpNext({ items, onOpen }: { items: QueueItem[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-card border border-hairline bg-surface p-1.5 shadow-card">
      <div className="px-2.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">Up next</div>
      <ul className="mt-1 flex flex-col">
        {items.slice(0, 5).map((it) => (
          <li key={it.id}>
            <button onClick={() => onOpen(it.id)} className="flex w-full items-start gap-2 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-raised">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] bg-proof-soft text-[10px] font-bold text-proof-deep">
                {SOURCE_GLYPH[it.promptSource] ?? '✦'}
              </span>
              <span className="line-clamp-2 text-[12px] leading-snug text-ink">{it.question}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Stage (single focused question) ─────────────────────────────────────────────

function Stage({
  item,
  answer,
  setAnswer,
  editing,
  setEditing,
  pending,
  position,
  target,
  onDraft,
  onApprove,
  onSkip,
  onSample,
}: {
  item: QueueItem;
  answer: string;
  setAnswer: (s: string) => void;
  editing: boolean;
  setEditing: (b: boolean) => void;
  pending: boolean;
  position: number;
  target: number;
  onDraft: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onSample: () => void;
}) {
  const showDraft = !!item.draft && !editing;

  // Enter approves when a draft is on screen (flow, not form-filling).
  useEffect(() => {
    if (!showDraft || pending) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onApprove();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [showDraft, pending, onApprove]);

  return (
    <div className="overflow-hidden rounded-xl2 border border-hairline bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-hairline px-6 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          Today’s set · {Math.min(position, target)} of {target} · ~10 min
        </span>
        {item.value >= 90 && (
          <span className="rounded-full bg-proof-soft px-2 py-0.5 text-[10px] font-bold text-proof-deep">Highest value now</span>
        )}
      </div>
      <div className="px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-[11px] font-bold text-caution-deep">
            ✦ Coach
          </span>
          {item.contextLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">{item.contextLabel}</span>
          )}
          {item.spawnedBy && (
            <span className="rounded-full bg-proof-soft px-2 py-0.5 text-[9px] font-semibold text-proof-deep">just surfaced</span>
          )}
        </div>
        <div className="mt-3 font-serif text-[26px] leading-snug text-ink">{item.question}</div>
        {item.why && (
          <div className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
            ⌖ <b className="font-semibold text-ink">Why we’re asking:</b> {item.why}
          </div>
        )}
        {item.payoff && <div className="mt-1.5 text-[11.5px] font-semibold text-proof">↑ {item.payoff}</div>}

        {showDraft ? (
          <Draft draft={item.draft!} pending={pending} onApprove={onApprove} onEdit={() => setEditing(true)} onSkip={onSkip} />
        ) : (
          <>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Answer in your own words — rough is fine, your coach will structure it."
              className="mt-4 min-h-[94px] w-full resize-y rounded-field border border-hairline bg-raised px-4 py-3 text-sm text-ink outline-none focus:border-proof-ring focus:ring-4 focus:ring-proof/10"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                onClick={onDraft}
                disabled={pending || answer.trim().length < 3}
                className="rounded-field bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-50"
              >
                {pending ? 'Drafting…' : 'Draft evidence with AI →'}
              </button>
              <button onClick={onSample} disabled={pending} className="rounded-field border border-hairline bg-surface px-4 py-2 text-[12px] font-semibold text-ink-muted transition hover:text-ink">
                Use a sample answer
              </button>
              <button onClick={onSkip} disabled={pending} className="ml-auto text-[12px] font-semibold text-ink-subtle transition hover:text-ink">
                Skip →
              </button>
            </div>
          </>
        )}
        <div className="mt-3.5 text-[11px] leading-relaxed text-ink-subtle">
          Your coach drafts; you approve. We never invent a metric — blanks stay blank until you fill them.
          {showDraft && <span className="ml-1 text-ink-muted">Press <b>Enter</b> to approve.</span>}
        </div>
      </div>
    </div>
  );
}

function Draft({
  draft,
  pending,
  onApprove,
  onEdit,
  onSkip,
}: {
  draft: NonNullable<QueueItem['draft']>;
  pending: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="mt-4 rounded-card border border-proof-ring bg-proof-soft/40 px-4 py-4">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="rounded bg-proof-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-proof-deep">AI draft → your approval</span>
        </div>
        <div className="text-sm leading-relaxed text-ink">{draft.action}</div>
        {draft.result && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-proof-deep">Result</span>
            <span className="text-[13px] text-ink">{draft.result}</span>
            {draft.metric && <span className="rounded bg-proof-soft px-2 py-0.5 text-[10px] font-semibold text-proof-deep">{draft.metric}</span>}
          </div>
        )}
        {draft.needsMetric && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-caution-ring bg-caution-soft px-2.5 py-1.5 text-[11px] font-semibold text-caution-deep">
            ⚐ No number yet — we won’t invent one. Add it when you have it.
          </div>
        )}
      </div>
      <div className="mt-3.5 grid grid-cols-[1.5fr_1fr_1fr] gap-2.5">
        <button onClick={onApprove} disabled={pending} className="rounded-field bg-proof px-0 py-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-proof-deep disabled:opacity-50">
          {pending ? 'Saving…' : 'Approve into graph'}
        </button>
        <button onClick={onEdit} disabled={pending} className="rounded-field border border-hairline bg-surface px-0 py-3 text-[13px] font-bold text-ink transition hover:bg-raised disabled:opacity-50">
          Edit
        </button>
        <button onClick={onSkip} disabled={pending} className="rounded-field border border-hairline bg-surface px-0 py-3 text-[13px] font-bold text-ink-subtle transition hover:bg-raised disabled:opacity-50">
          Skip
        </button>
      </div>
    </>
  );
}

// ── Stop / caught-up / toast ────────────────────────────────────────────────────

function StopCard({
  captured,
  gained,
  hasMore,
  onKeepGoing,
}: {
  captured: { id: string; question: string }[];
  gained: number;
  hasMore: boolean;
  onKeepGoing: () => void;
}) {
  return (
    <div className="rounded-xl2 border border-proof-ring bg-surface p-8 text-center shadow-card">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-proof text-[22px] text-white">✓</div>
      <div className="mt-3 font-serif text-[26px] text-ink">Nice set — {captured.length} captured</div>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-ink-muted">
        {gained > 0 ? `Your graph strength climbed +${gained}. ` : ''}
        That’s a solid session. Your coach is never done — new prompts surface as you flag roles and screen leads.
      </p>
      {hasMore && (
        <button onClick={onKeepGoing} className="mt-4 rounded-field bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep">
          Keep going →
        </button>
      )}
      <div className="mt-3">
        <a href="/roleproof" className="text-[12px] font-semibold text-proof-deep hover:underline">
          Back to your leads →
        </a>
      </div>
    </div>
  );
}

function CaughtUp({ inSession = false, gained = 0 }: { inSession?: boolean; gained?: number }) {
  return (
    <div className="mt-6 rounded-card border border-hairline bg-surface p-8 text-center shadow-card">
      <div className="font-serif text-2xl text-ink">Your coach is all caught up</div>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-ink-muted">
        {inSession && gained > 0 ? `+${gained} strength this session. ` : ''}
        Nothing under-told right now. Flag a role or run a screening and new, provenance-tagged prompts surface here.
      </p>
    </div>
  );
}

function UndoToast({ question, onUndo, onDismiss }: { question: string; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="flex max-w-[520px] items-center gap-3 rounded-full border border-hairline bg-ink px-4 py-2.5 text-paper shadow-lg animate-fade-in">
        <span className="text-proof">✓</span>
        <span className="line-clamp-1 text-[13px]">Approved — “{question}”</span>
        <button onClick={onUndo} className="ml-1 shrink-0 rounded-full bg-paper/15 px-3 py-1 text-[12px] font-bold text-paper transition hover:bg-paper/25">
          Undo
        </button>
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-paper/60 transition hover:text-paper">
          ✕
        </button>
      </div>
    </div>
  );
}
