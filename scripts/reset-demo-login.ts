/**
 * Reset (sync) the demo login to the current APP_EMAIL / APP_PASSWORD — without a full
 * reseed. Run locally, pointed at the target DB (inline DIRECT_URL for production, exactly
 * like the seed). Idempotent; safe to run any time.
 *
 *   DIRECT_URL='postgresql://…pooler.supabase.com:6543/postgres' \
 *   APP_EMAIL='you@example.com' APP_PASSWORD='…' \
 *     npm run db:demo-login
 *
 * This is the recover path for the ensureDemoUser upsert: it re-writes the demo user's
 * email + password hash, then reads the row back and verifies the password round-trips.
 */
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { users, DEMO_OWNER_ID } from '../lib/db/schema';
import { env } from '../lib/env';
import { ensureDemoUser } from './seed';

// Mirrors lib/auth.ts verifyPassword — inlined so this CLI script never imports
// lib/auth (which pulls in next/headers and can't run outside a Next request).
function verify(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const orig = Buffer.from(hash, 'hex');
  const test = scryptSync(pw, salt, 64);
  return orig.length === test.length && timingSafeEqual(orig, test);
}

async function main() {
  const target = (env.directUrl || env.databaseUrl).replace(/:\/\/[^@]*@/, '://***@');
  console.log('▶ Syncing demo login →', target);
  await ensureDemoUser();

  const [u] = await db.select().from(users).where(eq(users.id, DEMO_OWNER_ID));
  if (!u) throw new Error('demo user missing after sync');
  const ok = verify(env.appPassword, u.passwordHash);
  console.log('  email:  ', u.email);
  console.log('  verify: ', ok ? 'OK ✓' : 'FAILED ✗');
  if (!ok) throw new Error('password round-trip failed — check APP_PASSWORD');
  console.log('✓ Demo login ready.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
