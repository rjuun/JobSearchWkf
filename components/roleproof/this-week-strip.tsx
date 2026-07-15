'use client';

/**
 * "This week" strip (Additive Plan · A3). Sits at the top of the board *above*
 * the full leads table, which stays exactly as it was. Surfaces the two leads the
 * fit × freshness × saturation weight says are most worth acting on now, so a user
 * with a long board has an obvious place to start instead of free-roaming.
 *
 * Reaction signal: opening a pick emits `this_week · pick_open` (fire-and-forget)
 * — the measure of whether users act on the picks vs. roam the table, which is the
 * fold question for promoting this into the Board's default triage view.
 */
import Link from 'next/link';
import { trackUxAction } from '@/app/actions/ux';
import type { WeekPick } from '@/lib/queries';
import { RpScore, rpNextAction, cn } from './kit';

export function ThisWeekStrip({ picks }: { picks: WeekPick[] }) {
  if (picks.length === 0) return null;
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="text-sm font-bold text-ink">This week</h2>
        <span className="rounded-full bg-proof-soft px-2 py-0.5 text-[11px] font-semibold text-proof-deep">
          worth acting on now
        </span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {picks.map((p) => {
          const next = rpNextAction(p.status, p.overallFitScore);
          return (
            <Link
              key={p.id}
              href={`/roleproof/leads/${p.id}`}
              onClick={() => void trackUxAction('this_week', 'pick_open', p.id)}
              className="flex items-center gap-4 rounded-card border border-proof-ring/70 bg-proof-soft/25 px-[18px] py-4 shadow-card transition hover:border-proof-ring hover:shadow-[0_2px_12px_-4px_rgba(19,122,91,.25)]"
            >
              <RpScore score={p.overallFitScore} className="w-12 shrink-0 text-[30px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{p.title}</div>
                <div className="truncate text-[13px] text-ink-muted">
                  {[p.company, p.city].filter(Boolean).join(' · ') || '—'}
                </div>
                {p.reasons.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.reasons.map((r) => (
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
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap text-[13px] font-bold',
                  next.actionable ? 'text-proof' : 'text-ink-subtle'
                )}
              >
                {next.label}
                {next.actionable ? ' →' : ''}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
