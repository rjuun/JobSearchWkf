/**
 * Minimal .env loader for standalone tsx scripts (seed/migrate/reset).
 * Next.js loads .env.local automatically for the app; these CLI scripts don't,
 * so we parse it here. Import this FIRST, before anything that reads process.env.
 * Dependency-free on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(file: string): void {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// .env.local wins over .env (matches Next.js precedence).
loadEnvFile('.env.local');
loadEnvFile('.env');
