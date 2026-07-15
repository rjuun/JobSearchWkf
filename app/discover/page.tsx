import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { env } from '@/lib/env';
import { currentOwnerId } from '@/lib/auth';
import { getCareerGraphFor } from '@/lib/queries';
import { discover, doorVerdict } from '@/lib/discover';
import { DiscoverView } from '@/components/roleproof/discover-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — discover' };

// C2 · Discover — Mirror + Unexpected Doors. Role archetypes scored against the
// user's graph with the existing B6 requirement-alignment formula. A door's "flag
// as target" reuses B3's is_target.
export default async function DiscoverPage() {
  if (!env.nextDiscover) redirect('/roleproof');
  const owner = await currentOwnerId();
  const graph = await getCareerGraphFor(owner);
  const { mirror, doors } = discover(graph);
  // R4 · attach the deterministic verdict server-side so the client panel just renders it.
  const doorsWithVerdict = doors.map((d) => ({ ...d, verdict: doorVerdict(d) }));

  return (
    <AppShell>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Discover</div>
      <h1 className="mt-1 font-serif text-[36px] leading-none text-ink">Where your evidence can take you</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
        Role shapes scored against your Career Graph — the same requirement-alignment maths the pipeline uses. The mirror shows
        who your evidence says you are; the doors are adjacent roles you already score well on. Flag a door to make it a target.
      </p>
      <DiscoverView mirror={mirror} doors={doorsWithVerdict} />
    </AppShell>
  );
}
