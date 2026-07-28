import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { flowCounts, listArchivedApplications } from '@/lib/queries';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { ArchiveList } from '@/components/roleproof/archive-list';
import { FlowTabs } from '@/components/roleproof/flow-tabs';
import { Frame } from '@/components/layout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — archive' };

/**
 * Stopped applications, as a reference body (CI · Scoring Phase Redesign Part 2,
 * §2.2.F). A sibling of the Flow tabs, not one of them — this is "look back",
 * not "keep working", and the page is styled to say so.
 */
export default async function ArchivePage() {
  if (!env.nextMonitoring) notFound();
  const [rows, counts] = await Promise.all([listArchivedApplications(), flowCounts()]);

  return (
    <RpShell back={{ href: '/roleproof', label: 'Board' }}>
      <Frame className="pt-8 pb-24">
        <h1 className="font-serif text-[36px] leading-none text-ink-muted">Archive</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-muted">
          Applications that ran their course. Worth opening when a new lead looks like one of these
          — the scores, the must-haves and the CV that went out are all still there.
        </p>

        <FlowTabs active="archive" counts={counts} showMonitoring />

        <div className="mt-6">
          <ArchiveList rows={rows} />
        </div>
      </Frame>
    </RpShell>
  );
}
