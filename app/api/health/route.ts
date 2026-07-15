import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

// Public liveness/readiness probe (excluded from auth in middleware).
// Must run per-request: a prerendered result would freeze the DB status at
// build time (when no database is reachable), reporting a permanent "down".
export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? 'up' : 'down',
      storage: process.env.SUPABASE_URL ? 'supabase' : 'filesystem',
      llm: process.env.LLM_MODE ?? 'mock',
    },
    { status: dbOk ? 200 : 503 }
  );
}
