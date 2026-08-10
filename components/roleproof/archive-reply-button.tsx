'use client';

/**
 * On-demand reply-assist for Archive rows (CI · Scoring Phase Redesign Part 2,
 * §2.2.E addendum, 2026-07-29).
 *
 * §2.2.E's DeclinePopup only ever fired at the moment a decline email was
 * *dropped*, live. Every backfilled/reconciled Archive row got there some
 * other way — never through that drop — so none of them ever got the
 * reply-assist. This is the same popup, same template, just opened by a
 * click instead of a drop; nothing about "recorded, here's a reply" stops
 * being true just because the recording happened via reconciliation instead
 * of a live drag.
 *
 * A tiny client island inside the otherwise server-rendered ArchiveList —
 * only this button and its popup ship JS, not the list itself. Sits in the
 * same stacking layer as "On file" (§ archive-list.tsx's stretched-card
 * comment): a real, clickable element painted above the row-wide Link, so
 * clicking it opens the popup instead of navigating to the lead.
 */
import { useState } from 'react';
import { DeclinePopup } from './decline-popup';

export function ArchiveReplyButton({
  company,
  title,
  contactEmail,
}: {
  company: string | null;
  title: string;
  contactEmail?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative z-[2] font-semibold text-ink-subtle underline-offset-2 hover:text-ink hover:underline"
      >
        Reply
      </button>
      {open && (
        <DeclinePopup company={company} title={title} senderEmail={contactEmail} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
