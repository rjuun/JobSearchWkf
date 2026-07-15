import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Card, PageHeader, ButtonLink } from '@/components/ui';
import { ProfileBack } from '@/components/profile-back';
import { getOnboardingState } from '@/lib/queries';
import { ImportStep, CurationGate } from '@/components/onboarding-wizard';
import { resetOnboardingAction } from '@/app/actions/onboarding';
import type { DraftGraph } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function OnboardingPage() {
  const ob = await getOnboardingState();
  const step = ob?.step ?? 'welcome';
  const draft = (ob?.draftGraph ?? null) as DraftGraph | null;

  return (
    <AppShell>
      <ProfileBack />
      <div className="mt-3">
        <PageHeader
          eyebrow="Career Graph · Onboarding"
          title="Build with AI"
          subtitle="Paste a CV or LinkedIn export. The AI drafts a Career Graph; you keep what's true. Nothing is saved until you say so."
        />
      </div>

      {step === 'reviewing' && draft ? (
        <CurationGate draft={draft} />
      ) : step === 'done' ? (
        <DonePanel />
      ) : (
        <ImportStep />
      )}
    </AppShell>
  );
}

function DonePanel() {
  return (
    <Card className="p-5 text-center sm:p-6">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-proof-soft text-proof-deep ring-1 ring-inset ring-proof-ring">
        <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-ink">Added to your Career Graph</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        Your kept evidence is now part of the graph. Review it, fill in any missing metrics, then
        capture a lead and tailor your first CV.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <ButtonLink href="/profile">See the Career Graph</ButtonLink>
        <form action={resetOnboardingAction}>
          <button className="rounded-field px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink">
            Import more
          </button>
        </form>
      </div>
      <p className="mt-4 text-xs text-ink-subtle">
        Next on the journey:{' '}
        <Link href="/roleproof/capture" className="font-medium text-proof-deep hover:text-proof">
          capture a job lead →
        </Link>
      </p>
    </Card>
  );
}
