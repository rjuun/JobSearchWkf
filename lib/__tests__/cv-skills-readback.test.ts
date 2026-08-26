/**
 * CI · CV Template Output Format — the Skills read-back.
 *
 * This parser is the only way anything downstream learns what the CV's Skills
 * section actually printed, and it broke silently once: the old version found
 * items by splitting each line on its colon, the section stopped putting a colon
 * on any line, and `verify-lead-run.ts` reported "0 in the .docx · 19 in the step
 * report" — a mismatch against C5, which is the wrong thing to go and look at.
 *
 * The cases below are the two real layouts and the two ways each has bitten.
 */
import { describe, it, expect } from 'vitest';
import { parseSkillGroups, parseSkillItems, skillsBlock } from '../docx/cv-skills';

// The current layout: category on its own line, skills inline beneath it.
const CURRENT = [
  'Shared Services & Operating Model Transformation',
  'Shared Services Centre Design & Build · Target Operating Model Design',
  'Finance & Management Reporting',
  'Finance Function Build & Team Leadership · Close Automation',
  'Additional Skills',
  'Cross-Functional Programme Leadership',
];

// The layout every CV generated before 2026-08-27 carries.
const LEGACY = [
  'Shared Services & Operating Model Transformation: Shared Services Centre Design & Build · Target Operating Model Design',
  'Finance & Management Reporting: Finance Function Build & Team Leadership · Close Automation',
  'Additional Skills: Cross-Functional Programme Leadership',
];

describe('parseSkillGroups', () => {
  it('reads the current bold-category / inline-items layout', () => {
    expect(parseSkillGroups(CURRENT)).toEqual([
      { category: 'Shared Services & Operating Model Transformation', items: ['Shared Services Centre Design & Build', 'Target Operating Model Design'] },
      { category: 'Finance & Management Reporting', items: ['Finance Function Build & Team Leadership', 'Close Automation'] },
      { category: 'Additional Skills', items: ['Cross-Functional Programme Leadership'] },
    ]);
  });

  it('still reads the pre-2026-08-27 "Category: items" layout', () => {
    expect(parseSkillGroups(LEGACY)).toEqual(parseSkillGroups(CURRENT));
  });

  // The bug that cost the old parser everything: a layout change removed the
  // colon it keyed on, and it returned nothing rather than failing.
  it('does not depend on a colon to find items', () => {
    expect(parseSkillItems(CURRENT)).toHaveLength(5);
  });

  // The bug that cost the first replacement one entry: a category holding a
  // single skill has no `·` to split on, and a `·` test drops it silently.
  it('keeps a category that holds exactly one skill', () => {
    expect(parseSkillItems(CURRENT)).toContain('Cross-Functional Programme Leadership');
    expect(parseSkillItems(LEGACY)).toContain('Cross-Functional Programme Leadership');
  });

  it('ignores blank lines pandoc leaves between paragraphs', () => {
    const spaced = CURRENT.flatMap((l) => [l, '']);
    expect(parseSkillItems(spaced)).toEqual(parseSkillItems(CURRENT));
  });

  it('drops a trailing category with no items rather than inventing one', () => {
    expect(parseSkillGroups([...CURRENT, 'Orphaned Category'])).toEqual(parseSkillGroups(CURRENT));
  });
});

describe('skillsBlock', () => {
  it('cuts the section out between its two banners', () => {
    const doc = ['PROFILE', 'some prose', 'SKILLS', ...CURRENT, 'PROFESSIONAL EXPERIENCE', 'a job'];
    expect(skillsBlock(doc)).toEqual(CURRENT);
  });

  it('returns null when the section is not there, so callers can say "unreadable"', () => {
    expect(skillsBlock(['PROFILE', 'prose'])).toBeNull();
    expect(skillsBlock(['SKILLS', 'a · b'])).toBeNull();
  });
});
