'use client';

/**
 * The Queue tab — only leads that genuinely need a human decision.
 *
 * Clean leads never reach here: runInitialChecks auto-advanced them to
 * `selected` the moment B2 and B3 both came back empty. So every row is a real
 * call, and the tab's count is an honest "needs you" signal rather than
 * "everything captured today".
 *
 * Each row gives you what you need to make that call without navigating away:
 * the flags themselves, the raw JD one click down, and B4's Key Patterns line
 * when the lead has one.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setScreeningGateAction, type ScreeningGate } from '@/app/actions/scoring-queue';
import { refreshFreshnessAction, runInitialChecksAction } from '@/app/actions/pipeline';
import { cn } from './kit';

export type QueueLead = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  jdText: string | null;
  keyPatterns: string | null;
  postedDays: number | null;
  freshnessBand: string | null;
  saturationBand: string | null;
  roadblocks: { dimension: string; detail: string }[];
  misalignments: { dimension: string; detail: string; severity?: string }[];
};

export function ScoringQueue({ leads }: { leads: QueueLead[] }) {
  if (leads.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Nothing waiting on you</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Leads only land here when the initial checks flag a roadblock or a misalignment. Clean ones
          go straight to Ready to score.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {leads.map((l) => (
        <QueueRow key={l.id} lead={l} />
      ))}
    </div>
  );
}

function QueueRow({ lead }: { lead: QueueLead }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showJd, setShowJd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = lead.status === 'hold';

  function decide(status: ScreeningGate) {
    setError(null);
    start(async () => {
      try {
        await setScreeningGateAction(lead.id, status);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that decision.');
      }
    });
  }

  // A held lead's B2-B4 never ran (B1 short-circuits), so there's nothing to
  // triage yet — "Screen anyway" is the override that runs them.
  function screenAnyway() {
    setError(null);
    start(async () => {
      try {
        await runInitialChecksAction(lead.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not run the checks.');
      }
    });
  }

  function recheckFreshness() {
    setError(null);
    start(async () => {
      try {
        await refreshFreshnessAction(lead.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not refresh freshness.');
      }
    });
  }

  return (
    <div className={cn('rounded-card border border-hairline bg-surface shadow-card', pending && 'opacity-60')}>
      <div className="px-[18px] py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/roleproof/leads/${lead.id}`}
              className="text-[15px] font-semibold text-ink transition hover:text-proof"
            >
              {lead.title}
            </Link>
            <div className="mt-0.5 truncate text-[13px] text-ink-muted">
              {[lead.company, lead.city].filter(Boolean).join(' · ') || '—'}
              {lead.postedDays != null && ` · ${lead.postedDays}d old`}
              {lead.freshnessBand && ` · ${lead.freshnessBand}`}
              {lead.saturationBand && ` · ${lead.saturationBand}`}
            </div>
          </div>
          {held && (
            <span className="shrink-0 rounded-full bg-caution-soft px-2.5 py-1 text-[11px] font-semibold text-caution-deep">
              Held · posting looks old
            </span>
          )}
        </div>

        {/* Why it's here. Tones follow kit.tsx's vocabulary: a roadblock is a
            hard blocker (drop), a misalignment is a judgement call (caution). */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lead.roadblocks.map((r, i) => (
            <Flag key={`rb-${i}`} tone="drop" dimension={r.dimension} detail={r.detail} />
          ))}
          {lead.misalignments.map((m, i) => (
            <Flag key={`mis-${i}`} tone="caution" dimension={m.dimension} detail={m.detail} />
          ))}
          {held && lead.roadblocks.length === 0 && lead.misalignments.length === 0 && (
            <span className="text-[13px] text-ink-subtle">
              Roadblock and misalignment checks haven&apos;t run — the freshness gate stopped this one first.
            </span>
          )}
        </div>

        {/* B4's "Key Patterns & CV Tailoring Notes". Blank on every lead scored
            before the notes -> key_patterns write path was fixed. */}
        {lead.keyPatterns && (
          <p className="mt-3 border-l-2 border-hairline pl-3 text-[13px] leading-relaxed text-ink-muted">
            {lead.keyPatterns}
          </p>
        )}

        {error && <p className="mt-3 text-[13px] font-medium text-drop">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {held ? (
            <>
              <GateButton onClick={screenAnyway} disabled={pending} tone="proof">
                Screen anyway
              </GateButton>
              <GateButton onClick={recheckFreshness} disabled={pending} tone="neutral">
                Re-check freshness
              </GateButton>
            </>
          ) : (
            <>
              <GateButton onClick={() => decide('selected')} disabled={pending} tone="proof">
                Selected
              </GateButton>
              <GateButton onClick={() => decide('roadblocked')} disabled={pending} tone="drop">
                Roadblocked
              </GateButton>
              <GateButton onClick={() => decide('misaligned')} disabled={pending} tone="caution">
                Misaligned
              </GateButton>
            </>
          )}
          {lead.jdText && (
            <button
              type="button"
              onClick={() => setShowJd((v) => !v)}
              className="ml-auto text-[12px] font-semibold text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
            >
              {showJd ? 'Hide job description' : 'Show full job description'}
            </button>
          )}
        </div>
      </div>

      {showJd && lead.jdText && (
        <pre className="max-h-[420px] overflow-auto border-t border-hairline bg-raised/50 px-[18px] py-4 text-[12.5px] leading-relaxed text-ink-muted whitespace-pre-wrap font-sans">
          {lead.jdText}
        </pre>
      )}
    </div>
  );
}

function Flag({ tone, dimension, detail }: { tone: 'drop' | 'caution'; dimension: string; detail: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        tone === 'drop' ? 'bg-drop-soft text-drop-deep' : 'bg-caution-soft text-caution-deep'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'drop' ? 'bg-drop' : 'bg-caution')} />
      {dimension}
      {detail && <span className="font-normal opacity-80">· {detail}</span>}
    </span>
  );
}

function GateButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone: 'proof' | 'drop' | 'caution' | 'neutral';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-[9px] px-3.5 py-2 text-[12px] font-bold transition disabled:opacity-50',
        tone === 'proof' && 'bg-proof text-white hover:bg-proof-deep',
        tone === 'drop' && 'bg-drop-soft text-drop-deep hover:bg-drop hover:text-white',
        tone === 'caution' && 'bg-caution-soft text-caution-deep hover:bg-caution hover:text-white',
        tone === 'neutral' && 'bg-raised text-ink-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}
