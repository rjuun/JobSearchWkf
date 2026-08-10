'use client';

/**
 * A drop target for an email dragged out of Outlook — the presentational half of
 * the mechanic in use-email-drop.ts (CI · Scoring Phase Redesign Part 2 §2.2.C).
 *
 * The copy names the folders Reggie actually drags from (Bewerbungen for
 * confirmations, Absagen for declines) rather than assuming a raw-inbox drag.
 * The mechanic doesn't care which folder the file came from; the wording does,
 * because it has to match the gesture being asked for.
 *
 * Clicking, or dropping something with nothing usable in it, calls `onManual` —
 * the gesture works either way, it just becomes a short form instead.
 */
import { useCallback } from 'react';
import { useEmailDrop, type DropResult } from './use-email-drop';
import type { EmailArtifactKind } from '@/lib/applications';
import { cn } from './kit';

const HINT: Record<EmailArtifactKind, string> = {
  confirmation: 'Drop the confirmation email — from Bewerbungen',
  decline: 'Drop the decline — from Absagen',
  interview: 'Drop the invite — from Bewerbungen',
};

export function EmailDropZone({
  leadId,
  kind,
  label,
  tone = 'neutral',
  className,
  onCaptured,
  onManual,
}: {
  leadId: string;
  kind: EmailArtifactKind;
  label: string;
  tone?: 'neutral' | 'drop';
  className?: string;
  /**
   * A file or link landed — `link` is what goes in the DB column. `emailDate`/
   * `senderEmail` are whatever lib/email-parse.ts could read out of a real
   * dropped file (null for a dragged link, which has nothing to parse).
   */
  onCaptured: (link: string, emailDate: string | null, senderEmail: string | null) => void | Promise<void>;
  /** Nothing usable landed (or it was clicked): open the manual form instead. */
  onManual: () => void;
}) {
  const onResult = useCallback(
    async (result: DropResult) => {
      if (result.kind === 'captured') await onCaptured(result.link, result.emailDate, result.senderEmail);
      else onManual();
    },
    [onCaptured, onManual]
  );

  const { dropProps, over, busy, error } = useEmailDrop({ leadId, kind, onResult });

  return (
    <button
      type="button"
      onClick={onManual}
      disabled={busy}
      {...dropProps}
      title={HINT[kind]}
      className={cn(
        'rounded-[8px] border border-dashed px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-60',
        over
          ? 'border-proof bg-proof-soft text-proof-deep'
          : error
            ? 'border-drop bg-drop-soft text-drop-deep'
            : tone === 'drop'
              ? 'border-hairline text-ink-muted hover:border-drop hover:bg-drop-soft/50 hover:text-drop-deep'
              : 'border-hairline text-ink-muted hover:border-proof-ring hover:bg-proof-soft/50 hover:text-proof-deep',
        className
      )}
    >
      {busy ? 'Saving…' : (error ?? label)}
    </button>
  );
}
