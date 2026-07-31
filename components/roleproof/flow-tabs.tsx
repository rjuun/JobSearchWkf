/**
 * The Flow tab strip (CI · Scoring Phase Redesign Part 2, §2.2.D/F/I).
 *
 * Queue → Ready to score → Results → Applications: one lead's life, left to
 * right. Extracted out of app/roleproof/scoring-queue/page.tsx (which owned the
 * markup inline) because Applications is its own route, so the strip now has to
 * span routes rather than switch a `?tab=` on one.
 *
 * Archive sits after a divider and reads muted: it's a sibling of the group, not
 * a member of it. "Look back", not "keep working" — the same distinction the
 * board already draws when it excludes archived leads from the active list.
 *
 * Not Pursued (2026-07-30) joins Archive on the muted side of the divider —
 * roadblocked/misaligned gate drops and SharePoint's "Not Proceeding" leads.
 * Same "look back" register as Archive, but deliberately not merged into it:
 * these leads never had an application to stop (lib/queries.ts §Not Pursued).
 */
import Link from 'next/link';
import { cn } from './kit';

export type FlowTab = 'queue' | 'ready' | 'results' | 'applications' | 'archive' | 'notPursued';

export type FlowCounts = Partial<Record<FlowTab, number>>;

const FLOW: { key: FlowTab; label: string; href: string }[] = [
  { key: 'queue', label: 'Queue', href: '/roleproof/scoring-queue?tab=queue' },
  { key: 'ready', label: 'Ready to score', href: '/roleproof/scoring-queue?tab=ready' },
  { key: 'results', label: 'Results', href: '/roleproof/scoring-queue?tab=results' },
  { key: 'applications', label: 'Applications', href: '/roleproof/applications' },
];

export function FlowTabs({
  active,
  counts,
  showMonitoring,
}: {
  active: FlowTab;
  counts: FlowCounts;
  /** `env.nextMonitoring` — hides the two D-phase entries when the flag is off. */
  showMonitoring: boolean;
}) {
  const tabs = showMonitoring ? FLOW : FLOW.filter((t) => t.key !== 'applications');

  return (
    <div className="mt-7 flex items-center gap-1 border-b border-hairline">
      {tabs.map((t) => (
        <Tab
          key={t.key}
          label={t.label}
          href={t.href}
          active={active === t.key}
          count={counts[t.key] ?? 0}
        />
      ))}
      {showMonitoring && (
        <>
          <span className="mx-2 h-5 w-px bg-hairline" aria-hidden />
          <Tab
            label="Archive"
            href="/roleproof/archive"
            active={active === 'archive'}
            count={counts.archive ?? 0}
            muted
          />
          <Tab
            label="Not Pursued"
            href="/roleproof/not-pursued"
            active={active === 'notPursued'}
            count={counts.notPursued ?? 0}
            muted
          />
        </>
      )}
    </div>
  );
}

function Tab({
  label,
  href,
  active,
  count,
  muted,
}: {
  label: string;
  href: string;
  active: boolean;
  count: number;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        '-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition',
        active
          ? muted
            ? 'border-ink-subtle text-ink-muted'
            : 'border-proof text-ink'
          : muted
            ? 'border-transparent text-ink-subtle hover:text-ink-muted'
            : 'border-transparent text-ink-muted hover:text-ink'
      )}
    >
      {label}
      {count > 0 && (
        <span
          className={cn(
            'ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            label === 'Queue' ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-muted'
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
