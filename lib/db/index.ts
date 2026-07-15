/** Drizzle client over postgres.js. Singleton to survive Next.js hot-reload. */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { _pgClient?: ReturnType<typeof postgres> };

// CLI scripts set DIRECT_URL (non-pooled) and get prepared statements; the Vercel
// app runtime uses the pooled DATABASE_URL, where pgbouncer's transaction mode
// rejects prepared statements — so disable them whenever we're on a Supabase pooler.
const url = env.directUrl || env.databaseUrl;
const pooled = /pooler\.supabase\.com|[:.]6543(\/|$|\?)/.test(url);
const client = globalForDb._pgClient ?? postgres(url, { max: 10, prepare: !pooled });
if (process.env.NODE_ENV !== 'production') globalForDb._pgClient = client;

export const db = drizzle(client, { schema });
export { schema };
