/**
 * Forces LLM_MODE=mock for a verification script — and lives in a module of its
 * own because writing `process.env.LLM_MODE = 'mock'` at the top of the script
 * itself does NOT work: imports are hoisted above every statement, so lib/env.ts
 * (which snapshots process.env once, at module scope) has already read the real
 * value before that line ever runs. Import order between modules IS preserved,
 * so importing this first is the only ordering that actually takes effect.
 *
 * Import it BEFORE ./_env — _env only fills in keys that are still undefined,
 * so setting the value here is what makes .env.local's LLM_MODE=live lose.
 */
process.env.LLM_MODE = 'mock';
