'use client';

/**
 * R3 · The Statement's re-entry ritual (board #2b/#2e). Shown on app entry when
 * activity has accrued since the owner last looked at their Statement — the trigger
 * that brings them *back*, closing the loop the Statement page alone couldn't.
 *
 * Emits `statement · banner_shown` (impression, the denominator) and
 * `statement · banner_open` (click-through). Dismiss stamps the seen-marker so the
 * banner clears without a nag; opening it does the same on the Statement page.
 */
import { useEffect, useRef, useState } from 'react';
import { trackUxAction } from '@/app/actions/ux';
import { markStatementSeenAction } from '@/app/actions/statement';

export function StatementReturnBanner({ newCount, headline }: { newCount: number; headline: string }) {
  const [dismissed, setDismissed] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (newCount > 0 && !shown.current) {
      shown.current = true;
      void trackUxAction('statement', 'banner_shown');
    }
  }, [newCount]);

  if (newCount <= 0 || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    void markStatementSeenAction(); // clearing the banner counts as "seen"
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-card border border-proof-ring bg-proof-soft/60 px-4 py-3 text-[13px] shadow-card">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-proof text-white">✦</span>
      <div className="min-w-0 flex-1">
        <span className="text-ink">
          Since you were last here: <b className="font-semibold text-proof-deep">{headline}</b>.
        </span>{' '}
        <a
          href="/statement"
          onClick={() => void trackUxAction('statement', 'banner_open')}
          className="font-semibold text-proof-deep underline transition hover:text-proof"
        >
          See your Statement →
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-ink-subtle transition hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
