/**
 * CI · Never Render a Position Header Over Nothing.
 *
 * **This state cannot be reached on live data, so these tests are the only thing
 * that will ever exercise it.** Every lead with a current shortlist fills at least
 * one slot in every position, and the last position sits at exactly one — so the
 * guard is one selection away from mattering and zero renders away from being
 * observed. Checking it by eye on a real CV is not available, now or later.
 *
 * `applyPositionGuard` is pure over `TemplateData` for that reason: the decision
 * is separable from the database, the model and the .docx, and separating it is
 * what makes it testable at all.
 */
import { describe, it, expect } from 'vitest';
import { applyPositionGuard } from '../pipeline/tailoring';
import { CV_SLOTS, slotCode, isRoleOverviewSlot } from '../cv-slots';
import type { TemplateData } from '../docx/template';

const LETTERS = [...new Set(CV_SLOTS.map((s) => slotCode(s)[0]))];
const overviewOf = (letter: string) => CV_SLOTS.find((s) => slotCode(s)[0] === letter && isRoleOverviewSlot(s))!;
const projectsOf = (letter: string) => CV_SLOTS.filter((s) => slotCode(s)[0] === letter && !isRoleOverviewSlot(s));

/** One responsibility per position, which is what the live profile carries (3–9
 *  rows each, `position_ref` = the letter). */
const RESPS = LETTERS.map((l) => ({ positionRef: l, text: `${l} role responsibility` }));

/**
 * A `TemplateData` where `filled` names the positions that have any content. A
 * filled position gets one project bullet; an empty one gets empty arrays for
 * every slot it owns — exactly the shape `fillSlots` produces once the refill is
 * gone.
 */
function dataWith(filled: readonly string[]): TemplateData {
  const data: TemplateData = {};
  for (const slot of CV_SLOTS) data[slot] = [];
  for (const letter of filled) data[projectsOf(letter)[0]] = ['a bullet'];
  return data;
}

const visible = (data: TemplateData, letter: string) => (data[`Position ${letter} Visible`] as string[]).length > 0;

describe('applyPositionGuard · nothing changes when every position has content', () => {
  it('marks every position visible and forces no overview', () => {
    const data = dataWith(LETTERS);
    applyPositionGuard(data, RESPS);
    for (const l of LETTERS) {
      expect(visible(data, l)).toBe(true);
      expect(data[overviewOf(l)]).toEqual([]);
    }
  });

  it('leaves an empty role overview alone when the position has projects', () => {
    // The owner's correction, and the thing this guard must NOT do: an overview
    // that lost on merit is the system working, and no heading announced it.
    const data = dataWith(LETTERS);
    applyPositionGuard(data, RESPS);
    expect(data[overviewOf(LETTERS[0])]).toEqual([]);
  });
});

describe('applyPositionGuard · an INTERIOR empty position is kept and filled', () => {
  const interior = LETTERS[1];

  it('keeps it visible rather than omitting it', () => {
    // A position missing from the middle of a career reads as concealed time,
    // not as formatting.
    const data = dataWith(LETTERS.filter((l) => l !== interior));
    applyPositionGuard(data, RESPS);
    expect(visible(data, interior)).toBe(true);
  });

  it('forces its role overview back in, from responsibilities', () => {
    const data = dataWith(LETTERS.filter((l) => l !== interior));
    applyPositionGuard(data, RESPS);
    expect(data[overviewOf(interior)]).toEqual([`${interior} role responsibility`]);
  });

  it('takes the FIRST responsibility, not all of them — one line, not a reconstruction', () => {
    const data = dataWith(LETTERS.filter((l) => l !== interior));
    applyPositionGuard(data, [
      { positionRef: interior, text: 'first' },
      { positionRef: interior, text: 'second' },
    ]);
    expect(data[overviewOf(interior)]).toEqual(['first']);
  });

  it('still refuses to omit it when there is no responsibility to fall back on', () => {
    // Degraded, and deliberately so: a bare header is bad, but a hole in the
    // record is worse, and this is the one case where neither is available.
    const data = dataWith(LETTERS.filter((l) => l !== interior));
    applyPositionGuard(data, []);
    expect(visible(data, interior)).toBe(true);
    expect(data[overviewOf(interior)]).toEqual([]);
  });
});

describe('applyPositionGuard · a TRAILING empty position is omitted whole', () => {
  const last = LETTERS[LETTERS.length - 1];

  it('omits it — header, dates and Direct Reports all go with it', () => {
    const data = dataWith(LETTERS.filter((l) => l !== last));
    applyPositionGuard(data, RESPS);
    expect(visible(data, last)).toBe(false);
  });

  it('does not force an overview into a position it is about to omit', () => {
    const data = dataWith(LETTERS.filter((l) => l !== last));
    applyPositionGuard(data, RESPS);
    expect(data[overviewOf(last)]).toEqual([]);
  });

  it('omits a whole trailing RUN, not just the final one', () => {
    const trailing = LETTERS.slice(-2);
    const data = dataWith(LETTERS.filter((l) => !trailing.includes(l)));
    applyPositionGuard(data, RESPS);
    for (const l of trailing) expect(visible(data, l)).toBe(false);
  });
});

describe('applyPositionGuard · interior and trailing together', () => {
  it('treats the two differently in one document — the whole point of the rule', () => {
    const interior = LETTERS[1];
    const last = LETTERS[LETTERS.length - 1];
    const data = dataWith(LETTERS.filter((l) => l !== interior && l !== last));
    applyPositionGuard(data, RESPS);

    expect(visible(data, interior)).toBe(true);
    expect(data[overviewOf(interior)]).toEqual([`${interior} role responsibility`]);
    expect(visible(data, last)).toBe(false);
  });
});

describe('applyPositionGuard · the rule is about sequence, not about a letter', () => {
  it('omits everything after the last filled position, whichever that is', () => {
    // Only the first position has content, so positions 2..n are ALL trailing —
    // including the ones that would be "interior" under a rule hard-coded to the
    // last letter.
    const data = dataWith([LETTERS[0]]);
    applyPositionGuard(data, RESPS);
    expect(visible(data, LETTERS[0])).toBe(true);
    for (const l of LETTERS.slice(1)) expect(visible(data, l)).toBe(false);
  });

  it('counts a role overview as content, so a position with only an overview is not trailing', () => {
    const data = dataWith(LETTERS.slice(0, -1));
    data[overviewOf(LETTERS[LETTERS.length - 1])] = ['a role overview and nothing else'];
    applyPositionGuard(data, RESPS);
    expect(visible(data, LETTERS[LETTERS.length - 1])).toBe(true);
  });

  it('omits every position when nothing at all was selected', () => {
    // Not a state C7 can reach — `templateFits` and C3's floor both stop it long
    // before here — but the loop must terminate sensibly rather than treat
    // "no last filled position" as "everything is interior".
    const data = dataWith([]);
    applyPositionGuard(data, RESPS);
    for (const l of LETTERS) expect(visible(data, l)).toBe(false);
  });
});
