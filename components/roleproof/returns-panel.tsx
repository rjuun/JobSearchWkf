'use client';

/**
 * Returns panel (Additive Plan · B2, tracking-first). Lists the applications the
 * user has sent (or downloaded a CV for) and lets them log what came back —
 * response / interview / screened-out / offer. No "lessons" yet: outcomes wait
 * until n is honest. The only question this answers now is the cheap, important
 * one — will users actually log returns? A stale application (no word in a week)
 * gets a gentle nudge; nothing is automated.
 *
 * The outcome control calls recordOutcomeAction, which emits `returns ·
 * outcome_logged` server-side — the reaction signal.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { recordOutcomeAction } from '@/app/actions/monitoring';
import { cn } from './kit';

export type ReturnItem = {
  id: string;
  leadId: string;
  title: string;
  company: string | null;
  status: string | null;
  appliedAt: string | null; // ISO
};

const OUTCOMES: { key: string; label: string; tone: 'proof' | 'caution' | 'drop' }[] = [
  { key: 'response', label: 'Response', tone: 'caution' },
  { key: 'interview', label: 'Interview', tone: 'proof' },
  { key: 'offer', label: 'Offer', tone: 'proof' },
  { key: 'screened_out', label: 'Screened out', tone: 'drop' },
];

const STATUS_LABEL: Record<string, string> = {
  downloaded: 'CV downloaded',
  applied: 'Applied',
  response: 'Response',
  interview: 'Interview',
  offer: 'Offer',
  screened_out: 'Screened out',
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function ReturnsPanel({ items }: { items: ReturnItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (items.length === 0) return null;

  function log(leadId: string, status: string) {
    start(async () => {
      await recordOutcomeAction(leadId, status);
      router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-bold text-ink">Returns</h2>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
        {items.map((it) => {
          const settled = it.status && ['response', 'interview', 'offer', 'screened_out'].includes(it.status);
          const days = daysSince(it.appliedAt);
          const stale = !settled && days != null && days >= 7;
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-3 border-b border-hairline/70 px-5 py-3.5 last:border-0">
              <Link href={`/roleproof/leads/${it.leadId}`} className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-ink">{it.title}</div>
                <div className="truncate text-[12px] text-ink-subtle">
                  {it.company || '—'}
                  {' · '}
                  <span className={cn(settled ? 'text-proof-deep' : 'text-ink-muted')}>{STATUS_LABEL[it.status ?? ''] ?? 'Sent'}</span>
                  {days != null && <span className="text-ink-subtle"> · {days === 0 ? 'today' : `${days}d ago`}</span>}
                  {stale && <span className="text-caution-deep"> · no word yet — worth a nudge?</span>}
                </div>
              </Link>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    disabled={pending}
                    onClick={() => log(it.leadId, o.key)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50',
                      it.status === o.key
                        ? o.tone === 'proof'
                          ? 'border-proof-ring bg-proof-soft text-proof-deep'
                          : o.tone === 'caution'
                            ? 'border-caution-ring bg-caution-soft text-caution-deep'
                            : 'border-drop-ring bg-drop-soft text-drop-deep'
                        : 'border-hairline bg-surface text-ink-muted hover:bg-raised hover:text-ink'
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
