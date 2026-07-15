'use server';

/**
 * R3 · The Statement's re-entry ritual (board #2b/#2e). The mark-seen seam: viewing
 * the Statement (or dismissing the return banner) stamps `profiles.statement_seen_at`,
 * so the "since you were last here" digest resets. Owner resolved server-side; the
 * whole thing is best-effort — a marker write must never surface as a user error.
 */
import { currentOwnerId } from '@/lib/auth';
import { markStatementSeen } from '@/lib/activity';

export async function markStatementSeenAction(): Promise<void> {
  try {
    await markStatementSeen(await currentOwnerId());
  } catch {
    /* never break the flow for a re-entry marker */
  }
}
