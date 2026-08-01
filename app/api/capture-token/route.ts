import { NextResponse } from 'next/server';
import { createCaptureToken, currentOwnerId } from '@/lib/auth';

// Self-serve capture token (CI · Capture - Self-Serve Capture Token for AI-Driven Path).
// Session-cookie-gated — NOT in middleware.ts's PUBLIC list, so a valid session is
// required to reach this at all. Mints a fresh 30-day capture token for the logged-in
// user via the same createCaptureToken() /api/ingest already trusts. Stateless JWT:
// there's nothing to look up or persist, so this can be called as often as needed
// (e.g. to rotate) and old tokens already issued simply remain valid until they expire.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ownerId = await currentOwnerId();
    const token = await createCaptureToken(ownerId);
    return NextResponse.json({ token, expiresInDays: 30 });
  } catch {
    // Belt-and-suspenders: middleware already requires a valid session cookie for
    // any path not in PUBLIC, so this only fires on a genuinely broken/expired
    // session slipping through — same fail-closed posture as currentOwnerId() itself.
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
}
