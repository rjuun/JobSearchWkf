import { defineConfig } from 'vitest/config';

// Minimal unit-test setup. The guardrails we test are pure functions (scoring,
// metric extraction), so a plain node environment is all we need — no jsdom, no
// DB. Path-alias-free: tests import via relative paths.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
