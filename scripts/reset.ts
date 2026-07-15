/**
 * Reset ONLY the demo tenant (Reggie) back to its seeded baseline — the familiar
 * state produced by the original workbooks — while leaving every other user's
 * account and data untouched. Run locally: `npm run db:reset`.
 *
 * Reuses the seed's building blocks (owner-scoped wipe + rebuild), so it reads the
 * same gitignored workbooks as `npm run seed`. Never run in CI. Use it to experiment
 * with the prototype and snap back to a known-good demo whenever you want.
 */
import './_env';
import { wipeOwner, buildDemoTenant, ensureDemoUser } from './seed';
import { DEMO_OWNER_ID } from '../lib/db/schema';

async function main() {
  console.log('▶ Resetting demo tenant to baseline…');
  await wipeOwner(DEMO_OWNER_ID);
  await buildDemoTenant();
  await ensureDemoUser();
  console.log('✔ demo tenant reset to baseline (experimental users left intact)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
