import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { env } from '@/lib/env';
import { targetCoverageMatrix } from '@/lib/queries';
import { CoverageMatrix } from '@/components/roleproof/coverage-matrix';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — coverage matrix' };

// B3 · Coverage Matrix — an additional lens on the Career Graph beside the strength
// meter. Shows, per target role, which Core/Important requirements the graph already
// evidences and which are still gaps (each gap links to the coach).
export default async function CoveragePage() {
  if (!env.nextCoverageMatrix) redirect('/profile');
  const rows = await targetCoverageMatrix();

  return (
    <AppShell>
      <Link href="/profile" className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink">
        <span aria-hidden>←</span> Back to your Career Graph
      </Link>
      <div className="mb-2 mt-3 flex items-center gap-2">
        <Link href="/profile" className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink">
          Strength meter
        </Link>
        <span aria-current="page" className="rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-ink">
          Coverage matrix
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Coverage matrix</h1>
      <p className="mt-1 max-w-[62ch] text-sm text-ink-muted">
        For every role you’ve flagged as a target, the must-haves your graph already proves — and the gaps still open.
        A <span className="font-semibold text-caution-deep">⚑ gap</span> links straight to the coach prompts that close it.
      </p>
      <CoverageMatrix rows={rows} />
    </AppShell>
  );
}
