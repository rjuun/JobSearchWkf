import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { scoringQueueData } from '@/lib/queries';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { ScoringQueue } from '@/components/roleproof/scoring-queue';
import { ReadyToScore } from '@/components/roleproof/ready-to-score';
import { Frame } from '@/components/layout';
import { RpScore, RpVerdictPill, rpNextAction, cn } from '@/components/roleproof/kit';

export const dynamic = 'force-dynamic';
// B4-B6 for a whole batch runs through a Server Action on this segment.
export const maxDuration = 60;
export const metadata: Metadata = { title: 'RoleProof — scoring queue' };

type Tab = 'queue' | 'ready' | 'results';
const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'ready', label: 'Ready to score' },
  { key: 'results', label: 'Results' },
];

/**
 * Queue → Ready to score → Results, the B-phase's three states as one page.
 *
 * Part 2 of the design doc adds Applications and Archive as siblings here;
 * that's a separate CI and deliberately not built yet.
 */
export default async function ScoringQueuePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  if (!env.nextScoringQueue) notFound();

  const { queue, ready, running, results } = await scoringQueueData();
  const tab: Tab = TABS.some((t) => t.key === searchParams.tab) ? (searchParams.tab as Tab) : 'queue';

  const counts: Record<Tab, number> = {
    queue: queue.length,
    ready: ready.length + running.length,
    results: results.length,
  };

  return (
    <RpShell back={{ href: '/roleproof', label: 'Board' }}>
      <Frame className="pt-8 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[36px] leading-none text-ink">Scoring queue</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Captured leads screen themselves. What lands here is the part that needs you — and the
              batch that&apos;s ready to run.
            </p>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mt-7 flex items-center gap-1 border-b border-hairline">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/roleproof/scoring-queue?tab=${t.key}`}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition',
                tab === t.key
                  ? 'border-proof text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              )}
            >
              {t.label}
              {counts[t.key] > 0 && (
                <span
                  className={cn(
                    'ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    t.key === 'queue' ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-muted'
                  )}
                >
                  {counts[t.key]}
                </span>
              )}
            </Link>
          ))}
        </div>

        <div className="mt-6">
          {tab === 'queue' && (
            <ScoringQueue
              leads={queue.map((l) => ({
                id: l.id,
                title: l.title,
                company: l.company,
                city: l.city,
                status: l.status,
                jdText: l.jdText,
                keyPatterns: l.keyPatterns,
                postedDays: l.postedDays,
                freshnessBand: l.freshnessBand,
                saturationBand: l.saturationBand,
                roadblocks: l.roadblocks ?? [],
                misalignments: l.misalignments ?? [],
              }))}
            />
          )}

          {tab === 'ready' && (
            <ReadyToScore
              ready={ready.map(toScorable)}
              running={running.map(toScorable)}
            />
          )}

          {tab === 'results' && <Results leads={results} />}
        </div>
      </Frame>
    </RpShell>
  );
}

/** `autoSelected` is inferred, not stored: a lead with nothing flagged reached
 *  `selected` without anyone clicking, since that's the only way B2/B3 clean
 *  leads get there. Anything with a flag was a human override. */
function toScorable(l: {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  updatedAt: Date;
  roadblocks: { dimension: string; detail: string }[] | null;
  misalignments: { dimension: string; detail: string }[] | null;
}) {
  return {
    id: l.id,
    title: l.title,
    company: l.company,
    city: l.city,
    status: l.status,
    updatedAt: l.updatedAt.toISOString(),
    autoSelected: (l.roadblocks?.length ?? 0) === 0 && (l.misalignments?.length ?? 0) === 0,
  };
}

/** What the batch produced, best fit first — reusing the board's score
 *  typography and verdict thresholds so the colour language stays consistent. */
function Results({
  leads,
}: {
  leads: { id: string; title: string; company: string | null; city: string | null; status: string; overallFitScore: number | null }[];
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">No results yet</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Run a batch from Ready to score and the scored leads land here, best fit first.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      {leads.map((l) => {
        const next = rpNextAction(l.status, l.overallFitScore);
        return (
          <Link
            key={l.id}
            href={`/roleproof/leads/${l.id}`}
            className="flex items-center gap-4 border-b border-hairline/70 px-5 py-3.5 transition last:border-0 hover:bg-raised/60"
          >
            <RpScore score={l.overallFitScore} className="w-12 shrink-0 text-[30px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{l.title}</div>
              <div className="truncate text-xs text-ink-subtle">
                {[l.company, l.city].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="hidden sm:block">
              <RpVerdictPill score={l.overallFitScore} />
            </div>
            <span
              className={cn(
                'w-[110px] shrink-0 whitespace-nowrap text-right text-[12px] font-bold',
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
  );
}
