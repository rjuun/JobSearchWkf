'use client';

/**
 * Sourcing Compass (Additive Plan · B4). Sits below the board's leads table without
 * touching it. Ranks the free-text sources the user captured by the average fit each
 * one produces — so a busy alert that only yields weak matches becomes visible and
 * retireable, and a quiet channel that yields strong ones earns more attention.
 *
 * Reaction signal: `sourcing_compass · open` fires once when the panel mounts — the
 * cheapest read on whether anyone looks at it (the fold question is whether it
 * actually changes which alerts a user keeps).
 */
import { useEffect, useRef } from 'react';
import { trackUxAction } from '@/app/actions/ux';
import type { SourceRow } from '@/lib/queries';
import { cn } from './kit';

export function SourcingCompass({ rows }: { rows: SourceRow[] }) {
  const emitted = useRef(false);
  useEffect(() => {
    if (!emitted.current && rows.length > 0) {
      emitted.current = true;
      void trackUxAction('sourcing_compass', 'open');
    }
  }, [rows.length]);

  if (rows.length === 0) return null;
  const best = rows.reduce((m, r) => Math.max(m, r.avgFit ?? 0), 0) || 10;

  return (
    <section className="mt-9">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="text-sm font-bold text-ink">Sourcing compass</h2>
        <span className="text-[12px] text-ink-subtle">which channels produce the best fit</span>
      </div>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
        {rows.map((r) => (
          <div key={r.source} className="flex items-center gap-4 border-b border-hairline/70 px-5 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-ink">{r.source}</div>
              <div className="text-[11.5px] text-ink-subtle">
                {r.count} lead{r.count === 1 ? '' : 's'}
                {r.scored > 0 ? ` · ${r.scored} scored` : ' · none scored yet'}
              </div>
            </div>
            <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-raised sm:block">
              <div
                className={cn('h-full rounded-full', (r.avgFit ?? 0) >= 7 ? 'bg-proof' : (r.avgFit ?? 0) >= 5.5 ? 'bg-caution' : 'bg-drop')}
                style={{ width: `${Math.round(((r.avgFit ?? 0) / best) * 100)}%` }}
              />
            </div>
            <div className="w-12 shrink-0 text-right">
              <span className="font-serif text-[22px] leading-none tabular-nums text-ink">
                {r.avgFit != null ? r.avgFit.toFixed(1) : '—'}
              </span>
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">avg fit</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
