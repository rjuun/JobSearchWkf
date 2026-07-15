import type { ReactNode } from 'react';
import { RpShell } from '@/components/roleproof/rp-shell';
import { Frame, PAGE_Y } from '@/components/layout';

/**
 * Frame for the Career Graph side (/profile/*, onboarding). Thin wrapper over the
 * single app shell (RpShell) — same chrome and header as the leads side — that
 * additionally auto-wraps content in the standard base-width Frame, so the
 * Career-Graph pages keep their gutter/width/rhythm without a second shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RpShell>
      <Frame className={PAGE_Y}>{children}</Frame>
    </RpShell>
  );
}
