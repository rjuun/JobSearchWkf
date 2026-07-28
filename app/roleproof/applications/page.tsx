import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listOpenApplications } from '@/lib/queries';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { ApplicationsList } from '@/components/roleproof/applications-list';
import { Frame } from '@/components/layout';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — applications' };

/**
 * The D-phase's "what's outstanding" view (CI · Scoring Phase Redesign Part 2,
 * §2.2.D) — the answer Reggie currently reconstructs from memory and his
 * mailbox. Response-pending and interview-scheduled rows in one list.
 */
export default async function ApplicationsPage() {
  if (!env.nextMonitoring) notFound();
  const rows = await listOpenApplications();

  return (
    <RpShell back={{ href: '/roleproof', label: 'Board' }}>
      <Frame className="pt-8 pb-24">
        <h1 className="font-serif text-[36px] leading-none text-ink">Applications</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-muted">
          Everything you&apos;ve sent that hasn&apos;t finished yet. Drag the email straight out of
          Outlook onto the row — an invite from Bewerbungen, a decline from Absagen — and the date
          and the copy of the email are recorded for you.
        </p>

        <div className="mt-7">
          <ApplicationsList
            rows={rows.map((r) => ({
              id: r.id,
              leadId: r.leadId,
              title: r.title,
              company: r.company,
              city: r.city,
              status: r.status,
              appliedAt: r.appliedAt?.toISOString() ?? null,
              updatedAt: r.updatedAt.toISOString(),
              confirmationEmailLink: r.confirmationEmailLink,
              outcomeEmailLink: r.outcomeEmailLink,
              outcomeAt: r.outcomeAt?.toISOString() ?? null,
              interviewAt: r.interviewAt?.toISOString() ?? null,
              overallFitScore: r.overallFitScore,
            }))}
          />
        </div>
      </Frame>
    </RpShell>
  );
}
