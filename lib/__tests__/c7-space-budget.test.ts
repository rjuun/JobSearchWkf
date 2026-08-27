/**
 * CI · C7 Space Rules Are Specified and Never Enforced.
 *
 * What is pinned here is the arithmetic of the space budget — the parts that are
 * pure and therefore testable without Word. The claim the tests CANNOT make is
 * the one that matters most: that the document is two pages. That is measured on
 * a rendered page (`scripts/cv-pages.ps1`), because a page count asserted in a
 * unit test is exactly the kind of unchecked number this CI exists to remove.
 */
import { describe, it, expect } from 'vitest';
import {
  PROFILE_MAX_LINES,
  PROFILE_WORDS,
  SKILL_CATEGORIES,
  SKILLS_PER_CATEGORY,
  SKILLS_CEILING,
  CHARS_PER_LINE,
  profileLines,
  renderedLines,
} from '../cv-budget';
import { capSkillGroups } from '../pipeline/skills';
import { CV_SLOTS, isRoleOverviewSlot, slotProjectName, slotPositionLetter } from '../cv-slots';

describe('the profile budget converts lines to words, never the reverse', () => {
  it('keeps the word ceiling inside the line ceiling', () => {
    // The whole point of expressing the rule in words: a profile written to the
    // instruction must render within the rule. If this fails, the conversion
    // constants moved and the template needs re-measuring — not the rule.
    expect(profileLines(PROFILE_WORDS.max)).toBeLessThanOrEqual(PROFILE_MAX_LINES);
  });

  it('leaves the floor comfortably under the ceiling, so C6 has room to write', () => {
    expect(PROFILE_WORDS.min).toBeLessThan(PROFILE_WORDS.max);
    expect(profileLines(PROFILE_WORDS.min)).toBeGreaterThan(1);
  });

  it('counts a paragraph by how many line-widths it fills', () => {
    expect(renderedLines('x'.repeat(CHARS_PER_LINE))).toBe(1);
    expect(renderedLines('x'.repeat(CHARS_PER_LINE + 1))).toBe(2);
    // Empty is not free — an empty paragraph still occupies its line. Nothing
    // should ever ask for one, but returning 0 would let a caller build a
    // document out of them and believe it cost nothing.
    expect(renderedLines('')).toBe(1);
  });
});

describe('capSkillGroups · the section ceiling', () => {
  const group = (category: string, n: number, tag = category) => ({ category, items: Array.from({ length: n }, (_, i) => `${tag}-${i + 1}`) });

  it('leaves a section already within the ceiling untouched', () => {
    const input = [group('A', 5), group('B', 5), group('C', 5), group('D', 5)];
    const out = capSkillGroups(input);
    expect(out.groups).toEqual(input);
    expect(out.dropped).toEqual([]);
  });

  it('repacks an over-full category into one with room rather than shedding', () => {
    // C5 §B.5: the way down to a smaller section is merging, never dropping. This
    // runs after the merge, so the least it can do is not drop what still fits.
    const out = capSkillGroups([group('A', 8), group('B', 2)]);
    expect(out.dropped).toEqual([]);
    expect(out.groups.map((g) => g.items.length)).toEqual([SKILLS_PER_CATEGORY.ceiling, 4]);
    // The two that overflowed A are the LAST two — priority order is preserved,
    // so what moves is what was least relevant.
    expect(out.groups[1].items).toEqual(['B-1', 'B-2', 'A-7', 'A-8']);
  });

  it('empties a category past the limit into the survivors', () => {
    const out = capSkillGroups([group('A', 2), group('B', 2), group('C', 2), group('D', 2), group('E', 2), group('F', 2)]);
    expect(out.groups).toHaveLength(SKILL_CATEGORIES.ceiling);
    expect(out.dropped).toEqual([]);
    // F's two entries survive inside the five categories that remain.
    expect(out.groups.flatMap((g) => g.items)).toContain('F-1');
  });

  it('fills every category to the ceiling before it sheds anything', () => {
    // 29 entries into a 5 × 6 grid: E overflows by three, and A–D each have one
    // slot left, so nothing is lost.
    const out = capSkillGroups([group('A', 5), group('B', 5), group('C', 5), group('D', 5), group('E', 9)]);
    expect(out.groups.flatMap((g) => g.items)).toHaveLength(SKILLS_CEILING - 1);
    expect(out.dropped).toEqual([]);
  });

  it('sheds from the least-relevant end once the grid is genuinely full, and names it', () => {
    const out = capSkillGroups([group('A', 5), group('B', 5), group('C', 5), group('D', 5), group('E', 12)]);
    expect(out.groups.flatMap((g) => g.items)).toHaveLength(SKILLS_CEILING);
    expect(out.dropped).toEqual(['E-11', 'E-12']);
  });

  it('never invents a category to hold the overflow', () => {
    // The capacity it repacks into is the categories the GROUPING CALL returned,
    // not `SKILL_CATEGORIES.ceiling` of them. Naming a capability area is C5's
    // one judgement (§B.1); a cap that opened a new heading to make room would be
    // making that judgement in code, and would have to name the thing something.
    const out = capSkillGroups([group('A', 10)]);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].items).toHaveLength(SKILLS_PER_CATEGORY.ceiling);
    expect(out.dropped).toEqual(['A-7', 'A-8', 'A-9', 'A-10']);
  });

  it('drops a category the repack left empty rather than printing a bare heading', () => {
    const out = capSkillGroups([group('A', 1), { category: 'Empty', items: [] }]);
    expect(out.groups.map((g) => g.category)).toEqual(['A']);
  });

  it('accepts an explicit shape, which is how a budget is measured before it ships', () => {
    const out = capSkillGroups([group('A', 6), group('B', 6)], 2, 5);
    expect(out.groups.map((g) => g.items.length)).toEqual([5, 5]);
    expect(out.dropped).toEqual(['A-6', 'B-6']);
  });
});

describe('CV slot helpers · what a caption is built from', () => {
  it('separates role overviews from project slots', () => {
    expect(CV_SLOTS.filter(isRoleOverviewSlot)).toHaveLength(4);
    expect(CV_SLOTS.filter((s) => !isRoleOverviewSlot(s))).toHaveLength(7);
  });

  it('reads a project name off its slot, so the caption is data rather than template text', () => {
    expect(slotProjectName('Professional Experience - A1. Outsourcing Framework Project')).toBe('Outsourcing Framework Project');
    expect(slotProjectName('Professional Experience - B2. Transfer Pricing')).toBe('Transfer Pricing');
  });

  it('reads the position a slot belongs to', () => {
    expect(slotPositionLetter('Professional Experience - C1. BBSA Merger Project')).toBe('C');
    expect(slotPositionLetter('Professional Experience - D0. Role Overview')).toBe('D');
  });
});
