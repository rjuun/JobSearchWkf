'use client';

/**
 * The decline reply-assist (CI · Scoring Phase Redesign Part 2, §2.2.E).
 *
 * An event, not a destination: a modal with no route and no back-button state.
 * By the time it appears the decline is already recorded and the lead is already
 * in the Archive — this only offers the reply. Skipping it undoes nothing.
 *
 * "Open in email" is a mailto: handoff to the user's own mail client. RoleProof
 * has no send integration and this CI does not add one (§2.0). There's no
 * recipient either: extracting the sender would mean parsing the dropped .msg,
 * which is explicitly out of scope — the mail client's own reply is one click
 * away from the message that's still sitting in Absagen.
 */
import { useEffect, useRef, useState } from 'react';

export function declineReplyText(company: string | null): string {
  const who = company?.trim() || 'your organisation';
  return `Thank you for letting me know, and for considering my profile. I remain very interested in ${who} and would welcome being considered for future roles that fit my background.`;
}

export function DeclinePopup({
  company,
  title,
  onClose,
}: {
  company: string | null;
  title: string;
  onClose: () => void;
}) {
  const body = declineReplyText(company);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent(`Re: ${title}`)}&body=${encodeURIComponent(body)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reply to the decline"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-card border border-hairline bg-surface p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-serif text-2xl text-ink">Recorded — it&apos;s in the Archive</div>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          Worth a short reply while it&apos;s fresh. Doors reopen more often than people expect.
        </p>

        <blockquote className="mt-4 rounded-card border border-hairline bg-raised/60 px-4 py-3 text-[13px] leading-relaxed text-ink">
          {body}
        </blockquote>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-[8px] bg-proof px-4 py-2 text-[13px] font-bold text-white transition hover:bg-proof-deep"
          >
            {copied ? 'Copied ✓' : 'Copy text'}
          </button>
          <a
            href={mailto}
            className="rounded-[8px] border border-hairline px-4 py-2 text-[13px] font-bold text-ink transition hover:border-proof-ring hover:bg-proof-soft/50"
          >
            Open in email
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto text-[13px] font-semibold text-ink-muted hover:text-ink"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
