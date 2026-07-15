import Link from 'next/link';
import { CoverageMatrix } from './coverage-matrix';
import type { CoverageRow } from '@/lib/queries';
import type { ActivityRow } from '@/lib/activity';

/**
 * R7 · 3a · The assembled Career-Graph face. Arranges components that already exist:
 * the Coverage Matrix (2a) as the primary face — what your evidence covers for the
 * roles you're chasing — with the Statement (2b) as a living-history rail. The
 * strength-meter view stays one click away (?view=meter). No new data.
 */
const KIND_GLYPH: Record<string, string> = {
  evidence_kept: '✓',
  coach_approved: '✦',
  target_flagged: '⌖',
  screening: '◎',
  cv_generated: '↓',
  story_generated: '✍',
  applied: '→',
  outcome: '★',
};

export function AssembledGraph({
  score,
  label,
  matrix,
  activity,
}: {
  score: number;
  label: string;
  matrix: CoverageRow[];
  activity: ActivityRow[];
}) {
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_300px]">
      {/* Primary face — the Coverage Matrix */}
      <div className="min-w-0">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Target coverage</h2>
            <p className="text-[12px] text-ink-subtle">what your evidence covers for the roles you&rsquo;re chasing</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="font-serif text-[28px] leading-none text-proof tabular-nums">{score}</span>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-proof-deep">{label}</div>
          </div>
        </div>
        <CoverageMatrix rows={matrix} />
      </div>

      {/* Living-history rail — the Statement */}
      <aside className="lg:sticky lg:top-[74px] lg:self-start">
        <div className="rounded-card border border-hairline bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Living history</div>
            <Link href="/statement" className="text-[11px] font-semibold text-proof-deep hover:underline">
              All →
            </Link>
          </div>
          {activity.length === 0 ? (
            <p className="mt-3 text-[12px] text-ink-subtle">Your moves land here as you work — keep evidence, screen a role, tailor a CV.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {activity.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 shrink-0 text-ink-subtle">{KIND_GLYPH[e.kind] ?? '•'}</span>
                  <span className="line-clamp-2 min-w-0 flex-1 text-ink-muted">{e.summary ?? e.kind.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
