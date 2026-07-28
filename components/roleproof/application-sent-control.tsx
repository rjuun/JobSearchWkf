'use client';

/**
 * "Application sent" — the first of the three drop targets (CI · Scoring Phase
 * Redesign Part 2, §2.2.H).
 *
 * The drop *is* the control: drag the confirmation email out of Outlook onto
 * this and the application is recorded, the email archived, and the link stored,
 * with no date or link typed by hand. The click path is the fallback for the one
 * case that has no email to drag — a portal application that never sent a
 * confirmation — and is deliberately two-step so it reads as the exception
 * rather than an equal alternative.
 *
 * §2.1's premise that this lives on a "Results" row didn't survive contact with
 * the code: the scoring-queue Results tab lists `screened` leads only, so a
 * `ready` lead renders on the board's All-leads table and on its own workspace
 * page instead. Both host this control; see §4 of the CI note.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { logApplicationSentAction } from '@/app/actions/monitoring';
import { useEmailDrop, type DropResult } from './use-email-drop';
import { cn } from './kit';

export function ApplicationSentControl({
  leadId,
  variant = 'row',
  className,
}: {
  leadId: string;
  /** `row` — the compact board chip. `panel` — the workspace's next-move button. */
  variant?: 'row' | 'panel';
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const onResult = useCallback(
    async (result: DropResult) => {
      await logApplicationSentAction(leadId, {
        confirmationEmailLink: result.kind === 'captured' ? result.link : null,
      });
      setConfirming(false);
      router.refresh();
    },
    [leadId, router]
  );

  const { dropProps, over, busy, error, submitManual } = useEmailDrop({
    leadId,
    kind: 'confirmation',
    onResult,
  });

  // Two-step: the first click only arms it. A drop needs neither click.
  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    submitManual();
  }

  const label = busy ? 'Saving…' : confirming ? 'Confirm — no email' : 'Application sent';

  if (variant === 'panel') {
    return (
      <div className={cn('shrink-0', className)}>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          {...dropProps}
          className={cn(
            'w-full rounded-[8px] border-2 border-dashed px-4 py-2 text-[13px] font-bold transition disabled:opacity-60',
            over
              ? 'border-white bg-white/25 text-white'
              : confirming
                ? 'border-white bg-white text-proof-deep'
                : 'border-white/40 bg-white/15 text-white hover:bg-white/25'
          )}
        >
          {label}
        </button>
        <p className="mt-1 text-[11px] leading-tight text-white/80">
          {error ?? (confirming ? 'No confirmation email? Click again to record it anyway.' : 'Drop the confirmation email here — from your Bewerbungen folder.')}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      {...dropProps}
      title={
        error ??
        'Drag the confirmation email here from your Bewerbungen folder — or click twice to record a send with no email.'
      }
      className={cn(
        'shrink-0 whitespace-nowrap rounded-[7px] border border-dashed px-2 py-1 text-[12px] font-bold transition disabled:opacity-60',
        over
          ? 'border-proof bg-proof-soft text-proof-deep'
          : error
            ? 'border-drop text-drop-deep'
            : confirming
              ? 'border-proof bg-proof text-white'
              : 'border-hairline text-proof hover:border-proof-ring hover:bg-proof-soft/50',
        className
      )}
    >
      {label}
    </button>
  );
}
