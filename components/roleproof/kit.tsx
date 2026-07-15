/**
 * RoleProof kit — shared presentational primitives for the rebrand surface.
 *
 * Pure/serverable (no hooks): score + verdict typography, stage pips, status pills,
 * and the colour logic that mirrors lib/scoring's thresholds (>=7 Proceed,
 * >=5.5 Borderline, else Hold) in plain language. Components consume the warm
 * semantic tokens, which are the global theme (:root) after the rebrand.
 */
import { cn } from '@/components/ui';
import { statusMeta } from '@/lib/ui';

export { cn };

export type RpTone = 'proof' | 'caution' | 'drop' | 'neutral';
export type Verdict = 'Proceed' | 'Borderline' | 'Hold' | 'Not screened';

/** Plain-language verdict from a 0–10 fit score (no model jargon — the "copy" variant). */
export function rpVerdict(score: number | null): Verdict {
  if (score == null) return 'Not screened';
  if (score >= 7) return 'Proceed';
  if (score >= 5.5) return 'Borderline';
  return 'Hold';
}

export function scoreTone(score: number | null): RpTone {
  if (score == null) return 'neutral';
  if (score >= 7) return 'proof';
  if (score >= 5.5) return 'caution';
  return 'drop';
}

export const SCORE_TEXT: Record<RpTone, string> = {
  proof: 'text-proof',
  caution: 'text-caution',
  drop: 'text-drop',
  neutral: 'text-ink-subtle',
};

const PILL: Record<RpTone, string> = {
  proof: 'bg-proof-soft text-proof-deep',
  caution: 'bg-caution-soft text-caution-deep',
  drop: 'bg-drop-soft text-drop-deep',
  neutral: 'bg-raised text-ink-muted',
};

const DOT: Record<RpTone, string> = {
  proof: 'bg-proof',
  caution: 'bg-caution',
  drop: 'bg-drop',
  neutral: 'bg-ink-subtle',
};

/** Big editorial serif score — the hero number. */
export function RpScore({
  score,
  className,
}: {
  score: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn('font-serif leading-none tabular-nums', SCORE_TEXT[scoreTone(score)], className)}
    >
      {score != null ? score.toFixed(1) : '—'}
    </span>
  );
}

/** Verdict pill with a leading dot. `label` overrides the derived verdict word. */
export function RpVerdictPill({
  score,
  label,
  className,
}: {
  score: number | null;
  label?: string;
  className?: string;
}) {
  const tone = scoreTone(score);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        PILL[tone],
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />
      {label ?? rpVerdict(score)}
    </span>
  );
}

// ── Journey position (lightweight, status-only — the board glances, detail uses lib/journey) ──

/** Stages completed before the current one, by lead status. Capture·Screen·Tailor·Apply. */
const COMPLETED: Record<string, number> = {
  captured: 0,
  screening: 1,
  hold: 1,
  screened: 2,
  promoted: 2,
  tailoring: 2,
  ready: 3,
  applied: 4,
  archived: 0,
};

/** Four connected dots showing how far a lead has travelled the pipeline. */
export function RpStagePips({ status, className }: { status: string; className?: string }) {
  const done = COMPLETED[status] ?? 0;
  return (
    <div className={cn('flex items-center', className)} aria-hidden>
      {[0, 1, 2, 3].map((i) => {
        const state = i < done ? 'done' : i === done ? 'current' : 'upcoming';
        return (
          <span key={i} className="flex items-center">
            {i > 0 && <span className={cn('h-0.5 w-3.5', i <= done ? 'bg-proof' : 'bg-hairline')} />}
            <span
              className={cn(
                'h-[7px] w-[7px] rounded-full',
                state === 'done'
                  ? 'bg-proof'
                  : state === 'current'
                    ? 'bg-surface ring-[1.5px] ring-proof'
                    : 'bg-surface ring-[1.5px] ring-hairline'
              )}
            />
          </span>
        );
      })}
    </div>
  );
}

const STAGE_PILL: Record<string, string> = {
  captured: 'bg-raised text-ink-muted',
  screening: 'bg-caution-soft text-caution-deep',
  hold: 'bg-drop-soft text-drop-deep',
  screened: 'bg-proof-soft text-proof-deep',
  promoted: 'bg-proof-soft text-proof-deep',
  tailoring: 'bg-proof-soft text-proof-deep',
  ready: 'bg-proof text-white',
  applied: 'bg-ink text-paper',
  archived: 'bg-raised text-ink-subtle',
};

/** Warm status pill — reuses the app's canonical status label, RoleProof tones. */
export function RpStagePill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold',
        STAGE_PILL[status] ?? 'bg-raised text-ink-muted',
        className
      )}
    >
      {statusMeta(status).label}
    </span>
  );
}

/** The board's per-row next-action hint — plain language, no step codes. */
export function rpNextAction(
  status: string,
  score: number | null
): { label: string; actionable: boolean } {
  switch (status) {
    case 'captured':
      return { label: 'Screen', actionable: true };
    case 'screening':
      return { label: 'Running…', actionable: false };
    case 'hold':
      return { label: 'Review', actionable: true };
    case 'screened':
      return { label: (score ?? 0) >= 5.5 ? 'Promote' : 'Review', actionable: true };
    case 'promoted':
    case 'tailoring':
      return { label: 'Triage', actionable: true };
    case 'ready':
      return { label: 'Download', actionable: true };
    case 'applied':
      return { label: 'Applied', actionable: false };
    default:
      return { label: 'Review', actionable: false };
  }
}
