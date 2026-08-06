/**
 * C5's collapse floor.
 *
 * The defect being guarded: `C5`'s strict schema has `required: ['profile']`
 * and `z.string()` accepts `""`, so a degraded call returns `{"profile": ""}`.
 * `runStructured` logs `status='ok'`, `tailoring.ts` did `profileText =
 * r.data.profile.trim()` unconditionally, and the empty string then flowed
 * into the .docx (blank Profile section, unfilled `<<Profile>>` placeholder)
 * and into C7 (rating a CV whose profile section is empty). Structurally the
 * same family as C2's `placeholder` failure and C3's raw-text substitution —
 * a complete `required` list makes the key present, it cannot make the VALUE
 * meaningful — which is why this mirrors `c3-bullet-floor.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { isProfileTooShort, MIN_PROFILE_WORDS } from '../pipeline/tailoring';

describe('isProfileTooShort: what counts as a tailored profile', () => {
  it('rejects an empty string', () => {
    expect(isProfileTooShort('')).toBe(true);
  });

  it('rejects a whitespace-only string', () => {
    expect(isProfileTooShort('   \n\t  ')).toBe(true);
  });

  it('rejects a one-word reply', () => {
    expect(isProfileTooShort('Leader.')).toBe(true);
  });

  it('rejects a one-line stub well under the target', () => {
    expect(isProfileTooShort('Experienced senior leader with a strong track record.')).toBe(true);
  });

  it('accepts a realistic 70-110 word profile', () => {
    const words = Array.from({ length: 85 }, (_, i) => `word${i}`).join(' ');
    expect(isProfileTooShort(words)).toBe(false);
  });

  it('rejects one word short of the floor', () => {
    const words = Array.from({ length: MIN_PROFILE_WORDS - 1 }, (_, i) => `word${i}`).join(' ');
    expect(isProfileTooShort(words)).toBe(true);
  });

  it('accepts exactly MIN_PROFILE_WORDS words', () => {
    const words = Array.from({ length: MIN_PROFILE_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(isProfileTooShort(words)).toBe(false);
  });

  it('does not let an upper bound reject an over-long profile', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    expect(isProfileTooShort(words)).toBe(false);
  });

  it('ignores leading/trailing whitespace when counting', () => {
    const words = Array.from({ length: MIN_PROFILE_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(isProfileTooShort(`   ${words}   `)).toBe(false);
  });
});
