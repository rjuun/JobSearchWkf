'use client';

/**
 * R4 · Test a Door (board #5c). The honest verdict panel that opens *before* you
 * commit — the B6 fit already computed, the one or two things you'd strengthen, and
 * one deterministic line on whether it's a real adjacency, a genuine stretch, or a
 * reach. It names the stretch rather than flattering it (anti-optimisation), then
 * offers the same flag CTA. Presentational: DoorCard owns the flag/disagree actions.
 */
import type { DoorVerdict } from '@/lib/discover';
import type { DiscoverArchetype } from './discover-view';
import { cn } from './kit';

const STANCE: Record<DoorVerdict['stance'], { label: string; badge: string; accent: string }> = {
  adjacency: { label: 'Real adjacency', badge: 'bg-proof-soft text-proof-deep', accent: 'border-proof-ring' },
  stretch: { label: 'Genuine stretch', badge: 'bg-caution-soft text-caution-deep', accent: 'border-caution-ring' },
  reach: { label: 'A reach today', badge: 'bg-raised text-ink-subtle', accent: 'border-hairline' },
};

export function DoorVerdictPanel({
  door,
  verdict,
  pending,
  onFlag,
  onDisagree,
}: {
  door: DiscoverArchetype;
  verdict: DoorVerdict;
  pending: boolean;
  onFlag: () => void;
  onDisagree: () => void;
}) {
  const s = STANCE[verdict.stance];
  return (
    <div className={cn('mt-3 rounded-[11px] border bg-surface p-4', s.accent)}>
      <div className="flex items-center justify-between gap-3">
        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em]', s.badge)}>
          {s.label}
        </span>
        <span className="text-[11px] text-ink-subtle">
          fit <b className="font-semibold text-ink tabular-nums">{door.fit.toFixed(1)}</b> · {door.covered}/{door.total} covered
        </span>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-ink">{verdict.line}</p>

      {verdict.strengthen.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Close these first</div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {verdict.strengthen.map((g, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] text-caution-deep">
                <span className="mt-0.5 shrink-0">⚐</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onFlag}
          disabled={pending}
          className="rounded-[9px] bg-proof px-4 py-2 text-[12px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
        >
          {pending ? 'Flagging…' : 'Flag as target →'}
        </button>
        <button
          type="button"
          onClick={onDisagree}
          className="ml-auto text-[11.5px] font-semibold text-ink-subtle transition hover:text-drop-deep"
        >
          This doesn&rsquo;t sound right
        </button>
      </div>
    </div>
  );
}
