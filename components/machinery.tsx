'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from './ui';

/**
 * The "Machinery" layer (redesign_2 M4) — the second speed. Off by default, so the
 * plain-language surface is untouched; when on, it reveals the real step codes,
 * the B6 formula and evidence ref_codes the prototype shows. A single client flag,
 * persisted in localStorage, provided at the shell so header + pages share it.
 */
const MachineryCtx = createContext<{ on: boolean; toggle: () => void }>({ on: false, toggle: () => {} });
const STORAGE_KEY = 'rp-machinery';

export function MachineryProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  // Read the persisted flag after mount (SSR always renders "off" → additive).
  useEffect(() => {
    try {
      setOn(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* private mode / no storage — stay off */
    }
  }, []);
  const toggle = () =>
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  return <MachineryCtx.Provider value={{ on, toggle }}>{children}</MachineryCtx.Provider>;
}

export function useMachinery(): boolean {
  return useContext(MachineryCtx).on;
}

/** The header toggle. */
export function MachineryToggle({ className }: { className?: string }) {
  const { on, toggle } = useContext(MachineryCtx);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title="Show the step codes, the B6 formula & the gates"
      className={cn(
        'items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition',
        on ? 'bg-ink text-paper ring-ink' : 'bg-surface text-ink-muted ring-hairline hover:text-ink',
        className ?? 'inline-flex'
      )}
    >
      <span aria-hidden>⚙</span> Machinery
    </button>
  );
}

/** Render children only when machinery mode is on. */
export function Mach({ children }: { children: ReactNode }) {
  return useMachinery() ? <>{children}</> : null;
}

/** A monospace step-code badge — only visible in machinery mode. */
export function CodeBadge({ code, className }: { code: string; className?: string }) {
  if (!useMachinery()) return null;
  return (
    <span
      className={cn(
        'rounded bg-proof-soft px-1.5 py-0.5 align-middle font-mono text-[9px] font-semibold text-proof-deep',
        className
      )}
    >
      {code}
    </span>
  );
}
