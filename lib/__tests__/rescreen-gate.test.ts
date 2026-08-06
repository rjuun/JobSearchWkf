/**
 * CI · Make C2 Build on B6 Instead of Re-Deriving the Map §2.4 option (3) —
 * B2–B6 must not silently re-run on a lead that's already past `promoted` and
 * may carry approved `requirement_tailoring` rows. `rescreenBlocked` is the
 * pure predicate behind the gate in app/actions/pipeline.ts (and the client
 * confirm prompt in workspace.tsx); kept DB-free so it's testable without a
 * live lead, same pattern as `gateStatusFor` (screening-gate.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { rescreenBlocked, PAST_PROMOTED_STATUSES } from '../db/types';

describe('the B-phase re-screen gate', () => {
  it('blocks every past-promoted status without an override', () => {
    for (const status of PAST_PROMOTED_STATUSES) {
      expect(rescreenBlocked(status, false)).toBe(true);
    }
  });

  it('lets the explicit override through for every past-promoted status', () => {
    for (const status of PAST_PROMOTED_STATUSES) {
      expect(rescreenBlocked(status, true)).toBe(false);
    }
  });

  it('never blocks the everyday screening statuses, override or not', () => {
    const everyday = ['captured', 'screening', 'hold', 'screened', 'scoring_queue', 'roadblocked', 'misaligned', 'selected'];
    for (const status of everyday) {
      expect(rescreenBlocked(status, false)).toBe(false);
      expect(rescreenBlocked(status, true)).toBe(false);
    }
  });

  it('is exactly promoted/tailoring/ready/applied — nothing more, nothing less', () => {
    expect([...PAST_PROMOTED_STATUSES].sort()).toEqual(['applied', 'promoted', 'ready', 'tailoring'].sort());
  });

  it('archived is not gated — a re-screen there is between the owner and the archive, not this gate', () => {
    expect(rescreenBlocked('archived', false)).toBe(false);
  });
});
