/**
 * C2 · what the step is allowed to look at — CI · C2 Never Sees Nice-to-Have
 * Requirements §2.2.
 *
 * The economy argument lives entirely in this predicate: a Nice-to-Have
 * requirement is admitted only on the `carry` ticket, the one intake path that
 * transposes B6's already-chosen evidence with no model call. Every other
 * Nice-to-Have stays out, so the prompt C2 sends and the number of calls it
 * makes are exactly what they were before the door opened.
 */
import { describe, it, expect } from 'vitest';
import { c2AdmitsRequirement, tierFor } from '../pipeline/tailoring';

describe('c2AdmitsRequirement', () => {
  it('admits Core and Important at any rating, as it always did', () => {
    for (const rank of ['Core', 'Important']) {
      for (const s of ['Excellent', 'Very Strong', 'Good', 'Weak', 'No Match', null]) {
        expect(c2AdmitsRequirement(rank, s)).toBe(true);
      }
    }
  });

  it('admits a Nice-to-Have requirement only where B6 already found the evidence', () => {
    expect(c2AdmitsRequirement('Nice-to-Have', 'Excellent')).toBe(true);
    expect(c2AdmitsRequirement('Nice-to-Have', 'Very Strong')).toBe(true);
  });

  it('keeps every Nice-to-Have requirement that would cost a model call out', () => {
    // `Good` is `improve` and the rest are `dig`; both spend a call, which §2.2
    // rules out of scope. If this ever goes green for one of these, the prompt
    // has grown and the note's cost claim is no longer true.
    for (const s of ['Good', 'Weak', 'No Match', null]) {
      expect(tierFor(s)).not.toBe('carry');
      expect(c2AdmitsRequirement('Nice-to-Have', s)).toBe(false);
    }
  });

  it('admits nothing it does not recognise', () => {
    expect(c2AdmitsRequirement(null, 'Excellent')).toBe(false);
    expect(c2AdmitsRequirement('Desirable', 'Excellent')).toBe(false);
  });
});
