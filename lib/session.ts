/**
 * Shared session constants — edge-safe (no `next/headers`, no jose-server).
 * Imported by BOTH lib/auth.ts (Node) and middleware.ts (Edge), so the cookie
 * name and signing key have a single source of truth.
 */
import { env } from './env';

export const SESSION_COOKIE = 'jsc_session';
export const sessionKey = new TextEncoder().encode(env.sessionSecret);
