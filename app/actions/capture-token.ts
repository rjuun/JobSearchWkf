'use server';

import { createCaptureToken, currentOwnerId } from '@/lib/auth';

/**
 * CI · Self-Serve Capture Token for AI-Driven Path. Mints a fresh 30-day capture
 * token for /api/ingest. Stateless JWT — nothing to persist or look up, so this
 * can be called as often as the user likes (e.g. to get a new one after the old
 * one expires); it never invalidates a token issued earlier.
 */
export async function mintCaptureTokenAction(): Promise<{ token: string; expiresInDays: number }> {
  const owner = await currentOwnerId();
  const token = await createCaptureToken(owner);
  return { token, expiresInDays: 30 };
}
