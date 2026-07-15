'use client';

/**
 * Coverage Matrix (Additive Plan · B3). An additional lens beside the strength
 * meter — never a replacement. Explodes each target role's Core/Important
 * requirements into covered / gap cells; a gap deep-links straight to the coach
 * prompts that would close it, so the grid is addressable one cell at a time.
 *
 * Reaction signals: `coverage_matrix · open` (mount) and `· gap_click` (a gap cell
 * → coach). The fold question is whether the matrix, not the meter, should be the
 * Career Graph's primary face.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { trackUxAction } from '@/app/actions/ux';
import type { CoverageRow } from '@/lib/queries';
import { cn } from './kit';

export function CoverageMatrix({ rows }: { rows: CoverageRow[] }) {
  const emitted = useRef(false);
  useEffect(() => {
    if (!emitted.current) {
      emitted.current = true;
      void trackUxAction('coverage_matrix', 'open');
    }
  }, []);

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-hairline bg-surface p-10 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">No targets flagged yet</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Flag a role as a target from its workspace — its must-haves appear here as covered/gap cells you can close from the coach.
        </p>
        <Link href="/roleproof" className="mt-5 inline-flex rounded-[9px] bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep">
          Go to your board
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {rows.map((r) => {
        const pct = r.total ? Math.round((r.covered / r.total) * 100) : 0;
        return (
          <div key={r.leadId} className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{r.title}</div>
                {r.company && <div className="truncate text-[12px] text-ink-subtle">{r.company}</div>}
              </div>
              <div className="shrink-0 text-right">
                <span className={cn('font-serif text-[22px] leading-none tabular-nums', pct >= 70 ? 'text-proof' : pct >= 40 ? 'text-caution' : 'text-drop')}>
                  {r.covered}/{r.total}
                </span>
                <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">covered</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {r.cells.map((cell, i) =>
                cell.covered ? (
                  <span
                    key={i}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-proof-soft px-2.5 py-1 text-[11.5px] font-medium text-proof-deep"
                    title={`${cell.rank ?? ''} · covered`}
                  >
                    <span>✓</span>
                    <span className="truncate">{cell.requirement}</span>
                  </span>
                ) : (
                  <Link
                    key={i}
                    href={`/profile/coach?lead=${r.leadId}`}
                    onClick={() => void trackUxAction('coverage_matrix', 'gap_click', r.leadId)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-[11.5px] font-semibold text-caution-deep ring-1 ring-inset ring-caution-ring/50 transition hover:bg-caution-soft/70"
                    title={`${cell.rank ?? ''} · gap — close it with the coach`}
                  >
                    <span>⚑</span>
                    <span className="truncate">{cell.requirement}</span>
                    <span className="opacity-70">→</span>
                  </Link>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
