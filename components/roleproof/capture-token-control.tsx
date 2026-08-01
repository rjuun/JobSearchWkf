'use client';

/**
 * Capture token control (CI · Self-Serve Capture Token for AI-Driven Path). Lets the
 * user mint a fresh capture token for the AI-driven A1 path (/api/ingest) without
 * touching the DB directly. Nothing is persisted server-side — each click mints a new
 * 30-day JWT; older ones already handed out stay valid until they naturally expire.
 * Shown once per mint, same "reveal + copy" shape as ProofLinkControl.
 */
import { useState, useTransition } from 'react';
import { mintCaptureTokenAction } from '@/app/actions/capture-token';
import { cn } from './kit';

export function CaptureTokenControl() {
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function mint() {
    start(async () => {
      const { token } = await mintCaptureTokenAction();
      setToken(token);
      setCopied(false);
    });
  }
  function copy() {
    if (token && navigator.clipboard) {
      navigator.clipboard.writeText(token).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    }
  }

  return (
    <div className="mt-3 rounded-card border border-hairline bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[46ch]">
          <div className="text-[13px] font-semibold text-ink">Capture token</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Authorizes an AI-driven A1 capture (an agent POSTing a job lead to <code>/api/ingest</code> on
            your behalf) without a browser session. Valid 30 days from mint. Treat it as live auth
            material — don&rsquo;t paste it anywhere public.
          </p>
        </div>
        <button
          type="button"
          onClick={mint}
          disabled={pending}
          className="shrink-0 rounded-[9px] bg-proof px-4 py-2 text-[12px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
        >
          {pending ? '…' : token ? 'Get new token' : 'Generate token'}
        </button>
      </div>
      {token && (
        <div className="mt-3 flex items-center gap-2 rounded-field border border-hairline bg-raised px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-[12px] text-ink">{token}</code>
          <button
            type="button"
            onClick={copy}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold transition',
              copied ? 'bg-proof-soft text-proof-deep' : 'border border-hairline text-ink-muted hover:bg-surface'
            )}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
