/**
 * CI · C4 Skills Selection Produces Unreadable Overflow.
 *
 * Three decisions pinned: what may become a My Skills value, which skills print
 * (§A prioritisation), and what they print under (§B.1 categorisation).
 */
import { describe, it, expect } from 'vitest';
import {
  buildVocabIndex,
  resolveVocab,
  prioritiseSkills,
  reconcileSkillGroups,
  ungroupedSkills,
  dropLanguageSkills,
  SKILLS_ENVELOPE,
  type VocabEntry,
} from '../pipeline/skills';

const VOCAB: VocabEntry[] = [
  { name: 'Corporate Governance', source: 'skill', proficiency: 'Expert', variants: ['corporate governance', 'board governance', 'Supervisory Board', 'Management Board', 'General Assembly'] },
  { name: 'Change Management', source: 'skill', proficiency: 'Expert', variants: ['change management', 'change leadership', 'organisational change'] },
  { name: 'Complexity Management: Managing Complexity', source: 'competence', proficiency: null, variants: [] },
  { name: 'Resilience', source: 'attribute', proficiency: null, variants: [] },
];

describe('C2 · My Skills is a selection from the curated vocabulary', () => {
  const index = buildVocabIndex(VOCAB);

  it('resolves an ATS variant to the profile’s own spelling', () => {
    expect(resolveVocab(['General Assembly', 'board governance'], index)).toEqual(['Corporate Governance']);
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(resolveVocab(['  corporate   GOVERNANCE '], index)).toEqual(['Corporate Governance']);
  });

  it('drops free-text graph vocabulary rather than printing it', () => {
    expect(resolveVocab(['general assembly stuff', 'data reliability', 'hiring'], index)).toEqual([]);
  });

  it('never resolves by partial-token overlap', () => {
    // Regression guard: token subsumption once mapped the bare tag "Leadership"
    // onto Change Management via its "change leadership" variant.
    expect(resolveVocab(['Leadership'], index)).toEqual([]);
  });

  it('accepts competences and attributes, not just skills_master (epic Q3)', () => {
    expect(resolveVocab(['Resilience', 'Complexity Management: Managing Complexity'], index)).toHaveLength(2);
  });
});

describe('C4 §A · prioritiseSkills decides WHICH skills print', () => {
  it('orders Core, then Important, then Nice-to-Have', () => {
    expect(
      prioritiseSkills([
        { rank: 'Nice-to-Have', cvBulletSkills: ['MS Office Proficiency'] },
        { rank: 'Important', cvBulletSkills: ['Meeting & Event Management'] },
        { rank: 'Core', cvBulletSkills: ['Governance Process Ownership'] },
      ])
    ).toEqual(['Governance Process Ownership', 'Meeting & Event Management', 'MS Office Proficiency']);
  });

  it('keeps a skill once, at its best rank', () => {
    expect(
      prioritiseSkills([
        { rank: 'Important', cvBulletSkills: ['Executive Support'] },
        { rank: 'Core', cvBulletSkills: ['Executive Support'] },
      ])
    ).toEqual(['Executive Support']);
  });

  it('deduplicates case-insensitively, keeping the first spelling', () => {
    expect(prioritiseSkills([{ rank: 'Core', cvBulletSkills: ['Executive Support', 'EXECUTIVE support'] }])).toEqual([
      'Executive Support',
    ]);
  });

  it('queues unranked rows last, so they are first to fall off the cut', () => {
    const out = prioritiseSkills([
      { rank: null, cvBulletSkills: ['Unranked Skill'] },
      { rank: 'Core', cvBulletSkills: ['Core Skill'] },
    ]);
    expect(out).toEqual(['Core Skill', 'Unranked Skill']);
  });

  it('cuts to the envelope — "as the number of declared skills allows"', () => {
    const rows = [
      { rank: 'Core', cvBulletSkills: Array.from({ length: 30 }, (_, i) => `Core ${i}`) },
      { rank: 'Nice-to-Have', cvBulletSkills: Array.from({ length: 30 }, (_, i) => `Nice ${i}`) },
    ];
    const out = prioritiseSkills(rows);
    expect(out).toHaveLength(SKILLS_ENVELOPE);
    // Core survives whole; Nice-to-Have is what gets shed (§B.3).
    expect(out.filter((s) => s.startsWith('Core'))).toHaveLength(30);
    expect(out.filter((s) => s.startsWith('Nice'))).toHaveLength(10);
  });

  it('ignores blank and missing skill lists', () => {
    expect(prioritiseSkills([{ rank: 'Core', cvBulletSkills: null }, { rank: 'Core', cvBulletSkills: ['', ' '] }])).toEqual([]);
    expect(prioritiseSkills([])).toEqual([]);
  });
});

describe('C4 §B.4 · languages never appear in the Skills section', () => {
  const LANGS = ['Portuguese', 'English', 'German', 'Spanish'];

  it('strikes the entry that sent a language to the CV twice', () => {
    // The real case: "Communication: Business-Fluent English" was a one-item
    // category that existed only to house a fact the Languages section states.
    expect(dropLanguageSkills(['Business-Fluent English', 'Stakeholder Management'], LANGS)).toEqual([
      'Stakeholder Management',
    ]);
  });

  it('strikes a multi-language requirement phrase', () => {
    expect(dropLanguageSkills(['Fluency in English and German'], LANGS)).toEqual([]);
  });

  it('is unconditional — a Core requirement does not earn an exception', () => {
    expect(dropLanguageSkills(['German (C1)', 'Native Portuguese'], LANGS)).toEqual([]);
  });

  it('keeps a communication skill that is not a language', () => {
    expect(dropLanguageSkills(['Executive Communication', 'Precise Written Communication'], LANGS)).toHaveLength(2);
  });

  it('does not match a language name inside another word', () => {
    // Word boundaries, not substrings — "Englishing" is not a language claim,
    // and a substring rule would quietly eat unrelated entries.
    expect(dropLanguageSkills(['Germane Analysis'], LANGS)).toEqual(['Germane Analysis']);
  });

  it('is a no-op when the profile records no languages', () => {
    expect(dropLanguageSkills(['Business-Fluent English'], [])).toEqual(['Business-Fluent English']);
  });
});

describe('C4 §B.1 · reconcileSkillGroups decides what they print UNDER', () => {
  const SELECTED = ['Corporate Governance', 'Audit & Compliance Coordination', 'Change Management', 'Executive Support'];

  it('keeps the proposed categories and their order', () => {
    expect(
      reconcileSkillGroups(SELECTED, [
        { category: 'Governance, Risk & Compliance', skills: ['Corporate Governance', 'Audit & Compliance Coordination'] },
        { category: 'Transformation & Change', skills: ['Change Management', 'Executive Support'] },
      ])
    ).toEqual([
      { category: 'Governance, Risk & Compliance', items: ['Corporate Governance', 'Audit & Compliance Coordination'] },
      { category: 'Transformation & Change', items: ['Change Management', 'Executive Support'] },
    ]);
  });

  it('drops a skill the grouping step invented', () => {
    // The failure that matters most: text on the CV that no bullet declares.
    const out = reconcileSkillGroups(SELECTED, [
      { category: 'Governance', skills: ['Corporate Governance', 'Nuclear Engineering'] },
    ]);
    expect(out[0].items).toEqual(['Corporate Governance']);
    expect(JSON.stringify(out)).not.toContain('Nuclear');
  });

  it('prints the selected spelling, never the model’s rewording', () => {
    const out = reconcileSkillGroups(SELECTED, [{ category: 'Governance', skills: ['corporate  GOVERNANCE'] }]);
    expect(out[0].items).toEqual(['Corporate Governance']);
  });

  it('places a skill once when two categories claim it', () => {
    const out = reconcileSkillGroups(SELECTED, [
      { category: 'A', skills: ['Change Management'] },
      { category: 'B', skills: ['Change Management'] },
    ]);
    expect(out.filter((g) => g.items.includes('Change Management'))).toHaveLength(1);
  });

  it('never loses a skill the grouping step forgot to place', () => {
    const out = reconcileSkillGroups(SELECTED, [{ category: 'Governance', skills: ['Corporate Governance'] }]);
    const all = out.flatMap((g) => g.items);
    expect(all).toHaveLength(SELECTED.length);
    expect(out.at(-1)!.category).toBe('Additional Skills');
  });

  it('folds beyond 5 categories into the fifth rather than dropping their skills (§B.1)', () => {
    const selected = Array.from({ length: 7 }, (_, i) => `Skill ${i}`);
    const out = reconcileSkillGroups(
      selected,
      selected.map((s, i) => ({ category: `Cat ${i}`, skills: [s] }))
    );
    expect(out).toHaveLength(5);
    expect(out.flatMap((g) => g.items)).toHaveLength(7);
    expect(out[4].items).toEqual(['Skill 4', 'Skill 5', 'Skill 6']);
  });

  it('drops an empty or unnamed category', () => {
    const out = reconcileSkillGroups(['A'], [
      { category: '', skills: ['A'] },
      { category: 'Real', skills: ['A'] },
    ]);
    expect(out).toEqual([{ category: 'Real', items: ['A'] }]);
  });

  it('falls back to one honest bucket when nothing was proposed', () => {
    expect(ungroupedSkills(['A', 'B'])).toEqual([{ category: 'Core Competencies', items: ['A', 'B'] }]);
    expect(ungroupedSkills([])).toEqual([]);
  });
});
