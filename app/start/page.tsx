import { redirect } from 'next/navigation';
import { currentOwnerId } from '@/lib/auth';
import { getCareerGraph } from '@/lib/queries';
import { signalsOf } from '@/lib/career-graph';
import { RpShell } from '@/components/roleproof/rp-shell';
import { Frame } from '@/components/layout';
import { StartForm } from '@/components/start-form';

export const dynamic = 'force-dynamic';

/**
 * M4 · The screen-first cold start (Phase 3, Path A). The default front door for a new
 * user: paste a CV + one job ad and get a real verdict in minutes — the Career Graph is
 * born from it. Established users who land here (graph already built) go to their leads.
 */
export default async function StartPage({ searchParams }: { searchParams: { error?: string } }) {
  await currentOwnerId(); // gated by middleware; ensures a session
  const graph = await getCareerGraph();
  const sig = signalsOf(graph);
  if (sig.positions > 0 || sig.stars > 0) redirect('/roleproof');

  return (
    <RpShell>
      <Frame className="py-10">
        <div className="mx-auto max-w-[820px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-proof-deep">Start here</div>
          <h1 className="mt-1 font-serif text-[40px] leading-[1.05] text-ink">Is this role worth it?</h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-muted">
            Paste your CV and one job ad. In a couple of minutes you’ll have an honest Role-Fit verdict —
            and a Career Graph, born from your own history, ready to tailor a defensible CV. No forms, no
            data-entry wall.
          </p>
          <StartForm error={searchParams.error === '1'} />
          <p className="mt-6 text-center text-[12px] text-ink-subtle">
            Already have a job ad in hand? Great. If not, you can still build your graph from the coach later.
          </p>
        </div>
      </Frame>
    </RpShell>
  );
}
