import { AppShell } from '@/components/app-shell';
import { currentOwnerId } from '@/lib/auth';
import { env } from '@/lib/env';
import { getCareerGraphFor, getLead } from '@/lib/queries';
import { strengthOf } from '@/lib/career-graph';
import { generatePrompts, readQueue, readExcavationInvites } from '@/lib/coaching-queue';
import { CoachQueue } from '@/components/coach-queue';

export const dynamic = 'force-dynamic';

export default async function CoachPage({ searchParams }: { searchParams: { lead?: string; warmup?: string } }) {
  const owner = await currentOwnerId();
  // Load the graph ONCE and reuse it for generation + the strength meter (avoids a
  // second 12-table read per load). Lazily keep the queue current — the "never-done"
  // coach (engines 1–4; screening also fires generation so the bridge is immediate).
  const graph = await getCareerGraphFor(owner);
  await generatePrompts(owner, graph).catch(() => {});
  // Excavation invitations are gated by NEXT_EXCAVATION, not just their generation:
  // existing excavation prompts must stop surfacing the moment the flag is retired
  // (else the invite UI — and its telemetry — outlives the feature).
  const [groups, invites] = await Promise.all([
    readQueue(owner),
    env.nextExcavation ? readExcavationInvites(owner) : Promise.resolve([]),
  ]);
  const { score, ceiling, headroom, label, components } = strengthOf(graph);
  const openCount = groups.reduce((n, g) => n + g.items.length, 0);

  // Round-trip from a lead's screening watch-out: name where the user came from.
  const fromLead = searchParams.lead ? await getLead(searchParams.lead).catch(() => null) : null;

  return (
    <AppShell>
      <CoachQueue
        groups={groups}
        strength={score}
        ceiling={ceiling}
        headroom={headroom}
        label={label}
        components={components}
        openCount={openCount}
        invites={invites}
        fromRole={fromLead?.title ?? null}
        warmup={searchParams.warmup === '1'}
      />
    </AppShell>
  );
}
