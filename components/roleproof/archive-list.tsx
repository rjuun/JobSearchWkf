/**
 * The Archive (CI · Scoring Phase Redesign Part 2, §2.2.F) — stopped
 * applications, and only those.
 *
 * The point is pattern-matching: when a new lead looks like one that didn't go
 * anywhere, this is where you check what actually happened last time. So the
 * link into the lead's full detail (screening scores, requirements, the CV that
 * was sent) matters as much as the list, and every row is one.
 *
 * Deliberately *not* Part 1's roadblocked/misaligned triage drops — those never
 * had an application to stop. That data isn't lost; it's the raw material for
 * the separate stats CI §2.0 earmarks, which this one doesn't build.
 *
 * A server component: nothing here is interactive, and reading a body of
 * finished cases shouldn't ship a kilobyte of JavaScript.
 */
import Link from 'next/link';
import type { MonitoredApplication } from '@/lib/queries';
import { RpScore } from './kit';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ArchiveList({ rows }: { rows: MonitoredApplication[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Nothing stopped yet</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          When an application ends, it moves here — with its scores, its requirements and the CV
          that went out, so the next similar lead has something to be compared against.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/roleproof/leads/${row.leadId}`}
          className="flex items-center gap-4 border-b border-hairline/70 px-5 py-3.5 opacity-90 transition last:border-0 hover:bg-raised/60 hover:opacity-100"
        >
          <RpScore score={row.overallFitScore} className="w-12 shrink-0 text-[26px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{row.title}</div>
            <div className="truncate text-xs text-ink-subtle">
              {[row.company, row.city].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          {/* Reggie's note (2026-07-29): keep Status / Application Date / Process
              Close Date as three distinct, labeled pieces rather than folding
              the status word into the date line — easier to scan across rows. */}
          <div className="hidden shrink-0 grid-cols-3 gap-x-5 text-right text-[12px] sm:grid">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Status</div>
              <div className="text-ink-muted">Stopped</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Applied</div>
              <div className="text-ink-muted">{fmtDate(row.appliedAt)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Process closed</div>
              <div className="text-ink-muted">{fmtDate(row.outcomeAt)}</div>
            </div>
          </div>
          {row.outcomeEmailLink ? (
            <span className="hidden shrink-0 text-[12px] font-semibold text-ink-subtle md:block">
              Decline on file
            </span>
          ) : (
            <span className="hidden w-[92px] shrink-0 md:block" />
          )}
          <span className="shrink-0 whitespace-nowrap text-[12px] font-bold text-ink-subtle">
            Look back →
          </span>
        </Link>
      ))}
    </div>
  );
}
