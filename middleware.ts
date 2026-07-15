import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE, sessionKey } from '@/lib/session';

// Routes reachable without a session. `/p/` is the opt-in public Proof Link (C4);
// the trailing slash keeps it from matching /profile or /pipeline.
const PUBLIC = ['/login', '/signup', '/api/ingest', '/api/health', '/p/'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, sessionKey);
      return NextResponse.next();
    } catch {
      // fall through to redirect
    }
  }
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
