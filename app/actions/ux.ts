'use server';

/**
 * The client-callable seam for reaction instrumentation (Additive Plan · Wave A).
 * Client components (the interview brief, the "This week" strip, the coach queue)
 * call trackUxAction to emit a reaction event. Owner is resolved server-side from
 * the session — the client never asserts identity — and the whole thing is
 * best-effort, so a telemetry hiccup can never surface as a user-facing error.
 */
import { currentOwnerId } from '@/lib/auth';
import { recordUxEvent, type UxSurface, type UxEvent } from '@/lib/ux-events';

export async function trackUxAction(surface: UxSurface, event: UxEvent, leadId?: string | null): Promise<void> {
  try {
    const owner = await currentOwnerId();
    await recordUxEvent(owner, surface, event, { leadId: leadId ?? null });
  } catch {
    /* never break the flow for telemetry */
  }
}
