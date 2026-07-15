/**
 * Ensure the demo user exists: its id IS the DEMO_OWNER_ID that owns all the seeded data,
 * with the .env.local credentials (APP_EMAIL / APP_PASSWORD). Idempotent.
 */
import './_env';
import { scryptSync, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { users, DEMO_OWNER_ID } from '../lib/db/schema';
import { env } from '../lib/env';

function hash(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

async function main() {
  const email = env.appEmail.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.id, DEMO_OWNER_ID));
  if (existing) {
    console.log('demo user already present:', existing.email);
    return;
  }
  await db.insert(users).values({
    id: DEMO_OWNER_ID,
    email,
    passwordHash: hash(env.appPassword),
    name: 'Reginaldo (Reggie) Silva Junior',
  });
  console.log('seeded demo user:', email, '(id =', DEMO_OWNER_ID + ')');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
