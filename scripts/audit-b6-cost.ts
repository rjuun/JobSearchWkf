/**
 * Read-only: what a B6 call actually costs, from real `llm_calls` rows.
 *
 * Opus 4.8 / Opus 5 list rates, $ per million tokens:
 *   input 5.00 · output 25.00 · cache write (1h TTL, 2x) 10.00 · cache read (0.1x) 0.50
 *
 * Splits live B6 calls into healthy and collapsed using the measured signature
 * (a collapsed generation is short — a few hundred output tokens against a few
 * thousand), so the re-ask guard's expected cost can be computed from what a
 * wasted attempt really costs rather than from a worst case.
 */
import './_env';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../lib/db';
import { llmCalls } from '../lib/db/schema';

const IN = 5.0 / 1e6;
const OUT = 25.0 / 1e6;
const CACHE_W = 10.0 / 1e6;
const CACHE_R = 0.5 / 1e6;

const cost = (c: { inputTokens: number | null; outputTokens: number | null; cacheCreationTokens: number | null; cacheReadTokens: number | null }) =>
  (c.inputTokens ?? 0) * IN + (c.outputTokens ?? 0) * OUT + (c.cacheCreationTokens ?? 0) * CACHE_W + (c.cacheReadTokens ?? 0) * CACHE_R;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const calls = await db.select().from(llmCalls).where(eq(llmCalls.step, 'B6'));
  const live = calls.filter((c) => c.mode !== 'mock' && (c.outputTokens ?? 0) > 0);
  console.log(`B6 llm_calls rows: ${calls.length}  ·  live (non-mock): ${live.length}\n`);
  if (live.length === 0) return;

  // The measured collapse signature: a few hundred output tokens, not a few thousand.
  const COLLAPSE_OUT = 1000;
  const collapsed = live.filter((c) => (c.outputTokens ?? 0) < COLLAPSE_OUT);
  const healthy = live.filter((c) => (c.outputTokens ?? 0) >= COLLAPSE_OUT);

  const show = (label: string, rows: typeof live) => {
    if (rows.length === 0) {
      console.log(`${label}: none`);
      return 0;
    }
    const c = avg(rows.map(cost));
    console.log(
      `${label}: n=${rows.length}  ` +
        `in=${Math.round(avg(rows.map((r) => r.inputTokens ?? 0)))}  ` +
        `out=${Math.round(avg(rows.map((r) => r.outputTokens ?? 0)))}  ` +
        `cacheW=${Math.round(avg(rows.map((r) => r.cacheCreationTokens ?? 0)))}  ` +
        `cacheR=${Math.round(avg(rows.map((r) => r.cacheReadTokens ?? 0)))}  ` +
        `→ $${c.toFixed(4)} (${(c * 100).toFixed(2)}¢)`
    );
    return c;
  };

  console.log('── average B6 call ──');
  const all = show('all live      ', live);
  const good = show('healthy       ', healthy);
  const bad = show('collapsed     ', collapsed);

  // Expected calls under the guard, given a per-call collapse probability p and
  // up to 3 attempts: 1 + p + p^2 (the 2nd fires only if the 1st collapsed, etc).
  console.log('\n── expected cost per lead under the 3-attempt guard ──');
  console.log('  p = per-call collapse rate; a wasted attempt costs the COLLAPSED figure, not the healthy one.');
  for (const p of [0.1, 0.2, 0.3]) {
    // Expected wasted attempts = p + p^2; the successful attempt is the healthy cost.
    const wasted = (p + p * p) * bad;
    const total = good + wasted;
    console.log(
      `  p=${(p * 100).toFixed(0)}%  expected calls ${(1 + p + p * p).toFixed(2)}  ` +
        `→ $${total.toFixed(4)} (${(total * 100).toFixed(2)}¢)  ` +
        `vs ${(good * 100).toFixed(2)}¢ unguarded  ` +
        `= +${(((total - good) / good) * 100).toFixed(1)}%`
    );
  }

  // What the whole scoring half costs, for context — B5 is the other call.
  const b5 = (await db.select().from(llmCalls).where(eq(llmCalls.step, 'B5'))).filter((c) => c.mode !== 'mock' && (c.outputTokens ?? 0) > 0);
  if (b5.length) {
    // Sonnet rates: 3.00 in / 15.00 out per MTok.
    const b5cost = avg(
      b5.map((c) => (c.inputTokens ?? 0) * (3 / 1e6) + (c.outputTokens ?? 0) * (15 / 1e6) + (c.cacheCreationTokens ?? 0) * (6 / 1e6) + (c.cacheReadTokens ?? 0) * (0.3 / 1e6))
    );
    console.log(`\n  B5 (sonnet) average: ${(b5cost * 100).toFixed(2)}¢  →  B5+B6 per lead ≈ ${((b5cost + good) * 100).toFixed(2)}¢ healthy`);
  }
  void all;
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
