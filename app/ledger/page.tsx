import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentOwnerId } from '@/lib/auth';
import { env } from '@/lib/env';
import { recordUxEvent } from '@/lib/ux-events';
import { RpShell } from '@/components/roleproof/rp-shell';
import { Frame } from '@/components/layout';
import { StatementTabs } from '@/components/roleproof/statement-tabs';
import { TransitionLedger } from '@/components/roleproof/transition-ledger';
import { loadLedger } from '@/app/actions/ledger';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — your ledger' };

// R6 · The Transition Ledger — the long, slow search reframed as accumulation. A new
// lens beside the Statement, composing streams the app already writes. Reaction: ledger · open.
export default async function LedgerPage() {
  if (!env.nextLedger) redirect('/statement');
  const owner = await currentOwnerId();
  const ledger = await loadLedger();
  void recordUxEvent(owner, 'ledger', 'open');

  return (
    <RpShell>
      <Frame className="pt-8 pb-24">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">The long game</div>
        <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">Your transition ledger</h1>
        <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
          A slow search isn&rsquo;t stagnation — it&rsquo;s accumulation. Here&rsquo;s what these weeks actually built:
          evidence kept, CVs tailored, your story maturing, your graph climbing.
        </p>
        <StatementTabs active="ledger" showLedger={env.nextLedger} />
        <TransitionLedger ledger={ledger} />
      </Frame>
    </RpShell>
  );
}
