import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { flowCounts, listNotPursuedLeads } from '@/lib/queries';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { NotPursuedList } from '@/components/roleproof/not-pursued-list';
import { FlowTabs } from '@/components/roleproof/flow-tabs';
import { Frame } from '@/components/layout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — not pursued' };

/**
 * Roadblocked/misaligned gate drops, plus "Not Proceeding" leads (2026-07-30)
 * — a sibling of the Flow tabs and of Archive, not a member of either. Same
 * "look back" register as Archive, but these leads never had an application
 * to stop, so they don't belong in that list (components/roleproof/
 * archive-list.tsx flags exactly this as out of scope for it).
 */
export default async function NotPursuedPage() {
  if (!env.nextMonitoring) notFound();
  const [rows, counts] = await Promise.all([listNotPursuedLeads(), flowCounts()]);

  return (
    <RpShell back={{ href: '/roleproof', label: 'Board' }}>
      <Frame className="pt-8 pb-24">
        <h1 className="font-serif text-[36px] leading-none text-ink-muted">Not Pursued</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-muted">
          Dropped at the gate, or reviewed and chosen not to pursue — no application ever went
          out. Worth a glance when a new lead looks like one of these.
        </p>

        <FlowTabs active="notPursued" counts={counts} showMonitoring />

        <div className="mt-6">
          <NotPursuedList rows={rows} />
        </div>
      </Frame>
    </RpShell>
  );
}
