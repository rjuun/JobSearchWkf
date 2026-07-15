'use client';

/**
 * Proof Link control (Additive Plan · C4). Lets the user turn their public proof
 * summary on/off and copy the link. Opt-in, default off — the copy is careful to
 * say exactly what is and isn't shared, because this is the one surface that leaves
 * the authenticated app.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleProofLinkAction } from '@/app/actions/proof';
import { cn } from './kit';

export function ProofLinkControl({ enabled, token }: { enabled: boolean; token: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const url = token ? `${origin}/p/${token}` : '';

  function toggle(next: boolean) {
    start(async () => {
      await toggleProofLinkAction(next);
      router.refresh();
    });
  }
  function copy() {
    if (url && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    }
  }

  return (
    <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[46ch]">
          <div className="text-[13px] font-semibold text-ink">Public proof link</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            A read-only page proving the <b>substance</b> behind your profile — graph strength, evidence depth, targets in
            play. No contact details, no raw evidence. Off by default; revoke any time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggle(!enabled)}
          disabled={pending}
          className={cn(
            'shrink-0 rounded-[9px] px-4 py-2 text-[12px] font-bold transition disabled:opacity-60',
            enabled ? 'border border-hairline bg-surface text-ink-muted hover:bg-raised' : 'bg-proof text-white hover:bg-proof-deep'
          )}
        >
          {pending ? '…' : enabled ? 'Turn off' : 'Enable link'}
        </button>
      </div>
      {enabled && url && (
        <div className="mt-3 flex items-center gap-2 rounded-field border border-hairline bg-raised px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-[12px] text-ink">{url}</code>
          <button
            type="button"
            onClick={copy}
            className={cn('shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold transition', copied ? 'bg-proof-soft text-proof-deep' : 'border border-hairline text-ink-muted hover:bg-surface')}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
