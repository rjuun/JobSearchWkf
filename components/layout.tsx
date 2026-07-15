import type { ReactNode } from 'react';
import { cn } from '@/components/ui';

// ── One layout system for the whole app ───────────────────────────────────────
// Single source of truth for the page frame: every surface shares ONE content
// width and ONE horizontal gutter, so the margins line up everywhere — the board,
// the Career Graph, and both workspace views. No per-page exceptions. Vertical
// rhythm stays with the caller. Pure + presentational (no server imports) so
// client components can use it too.

/** The one content width. Everything centers to this — no per-surface overrides. */
const CONTENT = 'max-w-[1080px]';

/** Standard top/bottom rhythm for a page's first Frame (header gap + scroll room). */
export const PAGE_Y = 'pt-8 pb-24';

/**
 * The one content container: centers the page and applies the shared gutter + the
 * single content width. Pass vertical padding via `className` (e.g. "pt-8 pb-24").
 */
export function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full px-5 sm:px-6', CONTENT, className)}>{children}</div>;
}
