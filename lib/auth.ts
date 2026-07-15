/**
 * Multi-tenant session auth (O4). DB-backed users, jose-signed cookie carrying the user id.
 * `currentOwnerId()` is THE scoping primitive — every query/write is scoped to it. This maps 1:1
 * to Supabase Auth + RLS (`owner_id = auth.uid()`) on deploy; here it's enforced at the app layer.
 */
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, profiles } from './db/schema';
import { SESSION_COOKIE, sessionKey } from './session';

export { SESSION_COOKIE };

const CAPTURE_TOKEN_KIND = 'roleproof_capture';

// ── Password hashing (scrypt, no extra dependency) ───────────────────────────
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const orig = Buffer.from(hash, 'hex');
  const test = scryptSync(pw, salt, 64);
  return orig.length === test.length && timingSafeEqual(orig, test);
}

// ── Session ──────────────────────────────────────────────────────────────────
export async function createSession(userId: string, email: string): Promise<void> {
  const token = await new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(sessionKey);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

export async function getSession(): Promise<{ sub?: string; email: string } | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey);
    return { sub: payload.sub ? String(payload.sub) : undefined, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}

/**
 * The owner_id every query/write is scoped to — the logged-in user.
 * Fails closed: with no valid session it throws rather than silently falling back
 * to the demo owner (which would leak/mutate demo data on any unauthenticated path).
 * All app routes are behind middleware, so a session is always present here; this
 * only fires on a genuinely broken/expired state, surfacing it instead of hiding it.
 */
export async function currentOwnerId(): Promise<string> {
  const s = await getSession();
  if (s?.sub) return s.sub;
  // Back-compat for old email-only tokens: resolve via the users table.
  if (s?.email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, s.email.toLowerCase()));
    if (u) return u.id;
  }
  throw new Error('Not authenticated');
}

export async function createCaptureToken(ownerId: string): Promise<string> {
  return new SignJWT({ kind: CAPTURE_TOKEN_KIND })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ownerId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(sessionKey);
}

export async function verifyCaptureToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey);
    if (payload.kind !== CAPTURE_TOKEN_KIND) return null;
    return payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

// ── Users ────────────────────────────────────────────────────────────────────
export async function findUserByEmail(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return u ?? null;
}

/** DB credential check. Returns the user on success, null otherwise. */
export async function verifyCredentials(email: string, password: string) {
  const u = await findUserByEmail(email);
  if (!u) return null;
  return verifyPassword(password, u.passwordHash) ? u : null;
}

/** Create a user + their own (empty) profile row, scoped to them. */
export async function signupUser(
  email: string,
  password: string,
  name: string
): Promise<{ user: typeof users.$inferSelect } | { error: string }> {
  const e = email.trim().toLowerCase();
  if (!e || !password || password.length < 6) return { error: 'A valid email and a 6+ character password are required.' };
  if (await findUserByEmail(e)) return { error: 'An account with that email already exists.' };
  const [user] = await db
    .insert(users)
    .values({ email: e, passwordHash: hashPassword(password), name: name.trim() || null })
    .returning();
  await db.insert(profiles).values({ id: user.id, ownerId: user.id, name: name.trim() || e });
  return { user };
}
