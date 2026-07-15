import Link from 'next/link';
import { cn } from './kit';

/**
 * R6 · the tab pair that puts the Transition Ledger beside the Statement — two lenses
 * on the same accumulating search. Server component (just links); the Ledger tab hides
 * when NEXT_LEDGER is off.
 */
export function StatementTabs({ active, showLedger }: { active: 'statement' | 'ledger'; showLedger: boolean }) {
  const tab = (href: string, label: string, key: 'statement' | 'ledger') => (
    <Link
      href={href}
      className={cn(
        'rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition',
        active === key ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-raised'
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="mt-4 inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1 shadow-card">
      {tab('/statement', 'Statement', 'statement')}
      {showLedger && tab('/ledger', 'Ledger', 'ledger')}
    </div>
  );
}
