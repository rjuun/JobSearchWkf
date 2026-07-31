/**
 * The Not Pursued list (2026-07-30) — a sibling of the Archive, not a member
 * of it. Two very different things land here on purpose:
 *
 *   - roadblocked/misaligned gate drops (Scoring Phase Redesign Part 1) — a
 *     documented shortcoming caught before an application ever went out.
 *   - SharePoint's "Not Proceeding" leads — reviewed, chosen not to pursue,
 *     but *no* shortcoming: the role went stale, closed, or lost priority.
 *
 * Neither ever had an application to stop, which is exactly why this isn't
 * folded into the Archive (components/roleproof/archive-list.tsx's own header
 * comment flags this as deliberately out of scope for that list). The "why"
 * column here reads off the lead's own roadblocks/misalignments rather than
 * an application's outcome — see lib/queries.ts listNotPursuedLeads.
 *
 * A server component, same reasoning as ArchiveList: nothing here is
 * interactive beyond plain links.
 */
import Link from 'next/link';
import type { NotPursuedRow } from '@/lib/queries';
import { RpScore } from './kit';

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const REASON_LABEL: Record<NotPursuedRow['reason']['kind'], string> = {
  roadblocked: 'Roadblocked',
  misaligned: 'Misaligned',
  not_proceeding: 'Not proceeding',
};

const GRID = 'grid-cols-[44px_minmax(0,1.3fr)_112px_minmax(0,1.4fr)_100px]';

const HEAD_CELL = 'text-[10px] font-semibold uppercase tracking-wide text-ink-subtle';

export function NotPursuedList({ rows }: { rows: NotPursuedRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Nothing parked here yet</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Leads dropped at the gate, or marked not proceeding, land here — with the reason, so a
          similar lead is easy to recognise next time.
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
          <div className={`${HEAD_CELL} text-right`}>Updated</div>
          <div className={HEAD_CELL}>Why</div>
          <div />
        </div>

        {rows.map((row) => (
          <div
            key={row.leadId}
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
            <div className="relative z-[1] hidden text-right text-[12px] text-ink-muted sm:block">
              {fmtDate(row.updatedAt)}
            </div>
            <div className="relative z-[1] min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {REASON_LABEL[row.reason.kind]}
              </span>
              {row.reason.detail && (
                <div className="truncate text-[12px] text-ink-muted">{row.reason.detail}</div>
              )}
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
