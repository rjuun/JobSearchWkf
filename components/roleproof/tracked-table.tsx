'use client';

/**
 * R5 · a thin client wrapper that emits `weekly_triage · table_open` when a lead is
 * opened from the *raw* board table (rather than the judged triage above it). This is
 * the "free-roam" denominator against the triage's `pick_open`/`pick_tailor` — the
 * signal for the fold question "does the judged queue deserve to be the default?".
 * Only measured when the triage is actually shown (`enabled`), so it's apples-to-apples.
 */
import type { ReactNode } from 'react';
import { trackUxAction } from '@/app/actions/ux';

export function TrackedTable({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!enabled) return;
    const link = (e.target as HTMLElement).closest?.('a[href*="/roleproof/leads/"]');
    if (link) void trackUxAction('weekly_triage', 'table_open');
  }
  return <div onClickCapture={onClickCapture}>{children}</div>;
}
