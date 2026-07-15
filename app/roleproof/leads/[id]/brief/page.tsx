import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentOwnerId } from '@/lib/auth';
import { env } from '@/lib/env';
import { recordUxEvent } from '@/lib/ux-events';
import { RpShell } from '@/components/roleproof/rp-shell';
import { InterviewBriefFull } from '@/components/roleproof/interview-brief';
import { loadInterviewBrief } from '@/app/actions/interview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — interview brief' };

/**
 * R1 · the dedicated night-before surface — the full Interview Armament promised
 * by board #2c/#3c, one route past the CV-ready teaser. Read-only projection; the
 * page-open is the strongest `interview_brief · open` signal (the user walked to
 * the brief on purpose), tagged `view=full` so it reads apart from a teaser expand.
 */
export default async function InterviewBriefPage({ params }: { params: { id: string } }) {
  // Gate the dedicated surface behind its flag, like /discover, /ledger and /statement —
  // otherwise the route (and its `interview_brief · open` telemetry) stays live with the
  // flag off. Back to the workspace rather than a 404 so a stale link lands somewhere real.
  if (!env.nextInterviewBrief) redirect(`/roleproof/leads/${params.id}`);
  const loaded = await loadInterviewBrief(params.id);
  if (!loaded) notFound();

  const owner = await currentOwnerId();
  void recordUxEvent(owner, 'interview_brief', 'open', { leadId: params.id, meta: { view: 'full' } });

  return (
    <RpShell back={{ href: `/roleproof/leads/${params.id}`, label: 'Back to workspace' }}>
      <InterviewBriefFull
        leadId={loaded.lead.id}
        title={loaded.lead.title}
        company={loaded.lead.company}
        brief={loaded.brief}
      />
    </RpShell>
  );
}
