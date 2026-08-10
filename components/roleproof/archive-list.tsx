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
 * A server component: nothing here is interactive beyond plain links, and
 * reading a body of finished cases shouldn't ship a kilobyte of JavaScript.
 *
 * Reggie's note (2026-07-29): headers fixed once at the top, not repeated per
 * row, plus Email address / Email response as their own columns (SharePoint
 * reconciliation round 3). One shared grid template keeps the header and every
 * row pixel-aligned without a real <table> — a literal <table> can't have a
 * <tr> wrapped in an <a>.
 *
 * "Email response" (outcomeEmailLink) is a real, independently-clickable link
 * to the email itself — not nested inside the row's own Link (invalid HTML,
 * and doesn't reliably capture clicks anyway). Standard "stretched card"
 * layering instead: the row-wide Link is an absolutely-positioned layer
 * *behind* everything (z-0), and "On file" is a normal <a> painted on top
 * (relative, z-10) — clicks on it hit the email link, clicks anywhere else on
 * the row fall through to the lead-detail Link underneath. No JS needed.
 */
import Link from 'next/link';
import type { MonitoredApplication } from '@/lib/queries';
import { ArchiveReplyButton } from './archive-reply-button';
import { RpScore } from './kit';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const GRID = 'grid-cols-[44px_minmax(0,1.3fr)_76px_92px_104px_minmax(0,1fr)_100px_84px]';

const HEAD_CELL = 'text-[10px] font-semibold uppercase tracking-wide text-ink-subtle';

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
      <div className="max-h-[70vh] overflow-y-auto">
        <div
          className={`sticky top-0 z-10 hidden ${GRID} items-center gap-4 border-b border-hairline bg-raised/95 px-5 py-2.5 backdrop-blur sm:grid`}
        >
          <div />
          <div className={HEAD_CELL}>Role</div>
          <div className={`${HEAD_CELL} text-right`}>Status</div>
          <div className={`${HEAD_CELL} text-right`}>Applied</div>
          <div className={`${HEAD_CELL} text-right`}>Process closed</div>
          <div className={`hidden ${HEAD_CELL} md:block`}>Email address</div>
          <div className={`hidden ${HEAD_CELL} md:block`}>Email response</div>
          <div />
        </div>

        {rows.map((row) => (
          <div
            key={row.id}
            className={`relative grid ${GRID} items-center gap-4 border-b border-hairline/70 px-5 py-3.5 opacity-90 transition last:border-0 hover:bg-raised/60 hover:opacity-100`}
          >
            <Link href={`/roleproof/leads/${row.leadId}`} className="absolute inset-0 z-0" aria-label={row.title} />
            <RpScore score={row.overallFitScore} className="relative z-[1] text-[22px]" />
            <div className="relative z-[1] min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{row.title}</div>
              <div className="truncate text-xs text-ink-subtle">
                {[row.company, row.city].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="relative z-[1] hidden text-right text-[12px] text-ink-muted sm:block">Stopped</div>
            <div className="relative z-[1] hidden text-right text-[12px] text-ink-muted sm:block">
              {fmtDate(row.appliedAt)}
            </div>
            <div className="relative z-[1] hidden text-right text-[12px] text-ink-muted sm:block">
              {fmtDate(row.outcomeAt)}
            </div>
            <div className="relative z-[1] hidden truncate text-[12px] text-ink-subtle md:block">
              {row.contactEmail ?? '—'}
            </div>
            <div className="relative z-[1] hidden items-center gap-2 truncate text-[12px] font-semibold md:flex">
              {row.outcomeEmailLink ? (
                <a
                  href={row.outcomeEmailLink}
                  target="_blank"
                  rel="noreferrer"
                  className="relative z-[2] text-ink-subtle underline-offset-2 hover:text-ink hover:underline"
                >
                  On file ↗
                </a>
              ) : (
                <span className="text-ink-subtle">—</span>
              )}
              <span className="text-ink-subtle/50">·</span>
              <ArchiveReplyButton company={row.company} title={row.title} contactEmail={row.contactEmail} />
            </div>
            <Link
              href={`/roleproof/leads/${row.leadId}`}
              className="relative z-[1] shrink-0 whitespace-nowrap text-[12px] font-bold text-ink-subtle"
            >
              Look back →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
