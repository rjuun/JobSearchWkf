import './_env';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

async function main() {
  // Prefer the direct (non-pooled) connection for DDL — migrations need session
  // features and prepared statements that Supabase's transaction pooler rejects.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('✓ migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
