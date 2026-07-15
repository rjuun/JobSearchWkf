'use client';

/**
 * R5 · The Weekly Triage — the full #6a. Sits above the board table (which stays,
 * one scroll down). The A3 strip's two picks become the *head* of a judged queue:
 * capacity-trimmed picks, a "waiting" list ranked by priority, and an auto-held pile
 * of stale leads so nothing rots silently. All derivations are pure (lib/triage);
 * this is presentation + reactions.
 *
 * Reaction signals (surface `weekly_triage`): `pick_tailor` (acted on a this-week
 * pick) · `pick_open` (opened something from the waiting/held queue) vs the raw
 * table's `table_open` — the measure of whether the judged queue earns the default.
 */
import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trackUxAction } from '@/app/actions/ux';
import { setWeeklyCapacityAction } from '@/app/actions/triage';
import type { Triage, TriageItem } from '@/lib/triage';
import { RpScore, rpNextAction, cn } from './kit';

// Statuses where acting on a pick genuinely advances tailoring (vs. an early-stage
// screen/review). Keeps `pick_tailor` honest so the R5 fold question — does the judged
// queue drive tailoring? — isn't inflated by picks that were only opened to screen.
const TAILOR_STATUSES = new Set(['ready', 'promoted', 'tailoring']);
const pickEvent = (status: string): 'pick_open' | 'pick_tailor' =>
  TAILOR_STATUSES.has(status) ? 'pick_tailor' : 'pick_open';

export function WeeklyTriage({ triage }: { triage: Triage }) {
  const { picks, waiting, held, capacity, consideredCount } = triage;
  const router = useRouter();
  const [pending, start] = useTransition();

  // Below the narrowing threshold the judged queue adds little over the "Needs you" rail —
  // but stale postings must never rot silently (R5's whole point), so the held pile still
  // surfaces on its own even when there aren't enough live leads to judge.
  if (consideredCount < 3) {
    if (held.length === 0) return null;
    return (
      <section className="mt-7">
        <HeldPile held={held} />
      </section>
    );
  }

  function setCapacity(n: number) {
    start(async () => {
      await setWeeklyCapacityAction(n);
      router.refresh();
    });
  }

  return (
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold text-ink">This week</h2>
          <span className="rounded-full bg-proof-soft px-2 py-0.5 text-[11px] font-semibold text-proof-deep">
            the whole queue, judged
          </span>
        </div>
        {/* Capacity line + control */}
        <div className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span>
            Your pace: <b className="font-semibold text-ink tabular-nums">{capacity}</b>/week
          </span>
          <span className="inline-flex items-center overflow-hidden rounded-full border border-hairline">
            <button
              type="button"
              onClick={() => setCapacity(capacity - 1)}
              disabled={pending || capacity <= 1}
              aria-label="Fewer per week"
              className="px-2.5 py-1 text-ink-subtle transition hover:bg-raised disabled:opacity-40"
            >
              −
            </button>
            <span className="w-px self-stretch bg-hairline" />
            <button
              type="button"
              onClick={() => setCapacity(capacity + 1)}
              disabled={pending || capacity >= 7}
              aria-label="More per week"
              className="px-2.5 py-1 text-ink-subtle transition hover:bg-raised disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>
      </div>

      {/* Picks — act on these this week */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {picks.map((p) => (
          <PickCard key={p.id} item={p} event={pickEvent(p.status)} prominent />
        ))}
      </div>

      {/* Waiting — the rest of the judged queue */}
      {waiting.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-[12px] font-semibold text-ink-muted transition hover:text-ink">
            <span className="text-ink-subtle transition group-open:rotate-90">▸</span>
            Waiting in the queue · {waiting.length}
          </summary>
          <ul className="mt-2 flex flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            {waiting.map((w) => (
              <li key={w.id}>
                <WaitingRow item={w} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Auto-held — stale, verify before acting. Nothing rots silently. */}
      {held.length > 0 && <HeldPile held={held} />}
    </section>
  );
}

// The auto-held pile of stale postings — verify-before-acting. Rendered both inside the
// full triage and standalone on small boards, so stale leads never disappear silently.
function HeldPile({ held }: { held: TriageItem[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border border-caution-ring/60 bg-caution-soft/25">
      <div className="border-b border-caution-ring/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-caution-deep">
        Held — verify it&rsquo;s still open · {held.length}
      </div>
      <ul className="flex flex-col divide-y divide-hairline/70">
        {held.map((h) => (
          <li key={h.id}>
            <Link
              href={`/roleproof/leads/${h.id}`}
              onClick={() => void trackUxAction('weekly_triage', 'pick_open', h.id)}
              className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface/60"
            >
              <RpScore score={h.overallFitScore} className="w-10 shrink-0 text-[22px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{h.title}</div>
                <div className="truncate text-[11.5px] text-ink-subtle">
                  {[h.company, h.city].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {h.ageLabel && (
                <span className="shrink-0 rounded-full bg-caution-soft px-2 py-0.5 text-[10.5px] font-semibold text-caution-deep">
                  {h.ageLabel}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PickCard({ item, event, prominent }: { item: TriageItem; event: 'pick_open' | 'pick_tailor'; prominent?: boolean }) {
  const next = rpNextAction(item.status, item.overallFitScore);
  return (
    <Link
      href={`/roleproof/leads/${item.id}`}
      onClick={() => void trackUxAction('weekly_triage', event, item.id)}
      className={cn(
        'flex items-center gap-4 rounded-card border px-[18px] py-4 shadow-card transition',
        prominent
          ? 'border-proof-ring/70 bg-proof-soft/25 hover:border-proof-ring hover:shadow-[0_2px_12px_-4px_rgba(19,122,91,.25)]'
          : 'border-hairline bg-surface hover:bg-raised/60'
      )}
    >
      <RpScore score={item.overallFitScore} className="w-12 shrink-0 text-[30px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-ink">{item.title}</div>
        <div className="truncate text-[13px] text-ink-muted">{[item.company, item.city].filter(Boolean).join(' · ') || '—'}</div>
        {item.reasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.reasons.map((r) => (
              <span
                key={r}
                className="rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-proof-deep ring-1 ring-inset ring-proof-ring/60"
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className={cn('shrink-0 whitespace-nowrap text-[13px] font-bold', next.actionable ? 'text-proof' : 'text-ink-subtle')}>
        {next.label}
        {next.actionable ? ' →' : ''}
      </span>
    </Link>
  );
}

function WaitingRow({ item }: { item: TriageItem }) {
  const next = rpNextAction(item.status, item.overallFitScore);
  return (
    <Link
      href={`/roleproof/leads/${item.id}`}
      onClick={() => void trackUxAction('weekly_triage', 'pick_open', item.id)}
      className="flex items-center gap-3 border-b border-hairline/70 px-4 py-2.5 transition last:border-0 hover:bg-raised/60"
    >
      <RpScore score={item.overallFitScore} className="w-10 shrink-0 text-[22px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink">{item.title}</div>
        <div className="truncate text-[11.5px] text-ink-subtle">
          {[item.company, item.city].filter(Boolean).join(' · ') || '—'}
          {item.reasons[0] ? ` · ${item.reasons[0]}` : ''}
        </div>
      </div>
      <span className={cn('shrink-0 whitespace-nowrap text-[12px] font-bold', next.actionable ? 'text-proof' : 'text-ink-subtle')}>
        {next.label}
        {next.actionable ? ' →' : ''}
      </span>
    </Link>
  );
}
