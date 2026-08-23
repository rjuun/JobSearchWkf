/**
 * CI · C4 Skills Selection Produces Unreadable Overflow.
 *
 * The two decisions that produced the 67-skill line, pinned: what may become a
 * My Skills value, and what the CV's Skills section is built from.
 */
import { describe, it, expect } from 'vitest';
import { buildVocabIndex, resolveVocab, buildSkillsSection, SKILLS_ENVELOPE, type VocabEntry } from '../pipeline/skills';

const VOCAB: VocabEntry[] = [
  { name: 'Corporate Governance', source: 'skill', proficiency: 'Expert', variants: ['corporate governance', 'board governance', 'Supervisory Board', 'Management Board', 'General Assembly'] },
  { name: 'Change Management', source: 'skill', proficiency: 'Expert', variants: ['change management', 'change leadership', 'organisational change'] },
  { name: 'Stakeholder Management', source: 'skill', proficiency: 'Expert', variants: ['stakeholder management', 'executive engagement'] },
  { name: 'Complexity Management: Managing Complexity', source: 'competence', proficiency: null, variants: [] },
  { name: 'Resilience', source: 'attribute', proficiency: null, variants: [] },
];

describe('C2 · My Skills is a selection from the curated vocabulary', () => {
  const index = buildVocabIndex(VOCAB);

  it('resolves an ATS variant to the profile’s own spelling', () => {
    // "General Assembly" is how a graph tag words it; the CV must print the
    // skill the profile actually claims.
    expect(resolveVocab(['General Assembly', 'board governance'], index)).toEqual(['Corporate Governance']);
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(resolveVocab(['  corporate   GOVERNANCE '], index)).toEqual(['Corporate Governance']);
  });

  it('drops free-text graph vocabulary rather than printing it', () => {
    // The real long tail behind the 67: names that exist only as evidence
    // descriptors and appear in no curated table.
    expect(resolveVocab(['general assembly stuff', 'data reliability', 'hiring', 'board level'], index)).toEqual([]);
  });

  it('drops a name the model invented', () => {
    expect(resolveVocab(['Quantum Governance'], index)).toEqual([]);
  });

  it('never resolves by partial-token overlap', () => {
    // Regression guard for a matcher tried during this CI: token subsumption
    // mapped the bare tag "Leadership" onto Change Management, through its
    // "change leadership" variant. That is a claim the candidate never made.
    expect(resolveVocab(['Leadership'], index)).toEqual([]);
    expect(resolveVocab(['Management'], index)).toEqual([]);
  });

  it('collapses two variants of one skill to a single entry', () => {
    expect(resolveVocab(['Supervisory Board', 'Management Board', 'Corporate Governance'], index)).toEqual(['Corporate Governance']);
  });

  it('accepts competences and attributes, not just skills_master (epic Q3)', () => {
    expect(resolveVocab(['Resilience', 'Complexity Management: Managing Complexity'], index)).toEqual([
      'Resilience',
      'Complexity Management: Managing Complexity',
    ]);
  });

  it('keeps skills_master when a name is carried by two tables', () => {
    const dup = buildVocabIndex([
      { name: 'Resilience', source: 'skill', proficiency: 'Expert', variants: [] },
      { name: 'Resilience', source: 'attribute', proficiency: null, variants: [] },
    ]);
    expect(dup.get('resilience')?.source).toBe('skill');
  });
});

describe('C4 · the Skills section is the Keep rows’ Requirement Skills', () => {
  it('groups by requirement rank, highest first', () => {
    const out = buildSkillsSection([
      { rank: 'Core', requirementSkills: ['Governance Process Ownership', 'Executive Support'] },
      { rank: 'Important', requirementSkills: ['Meeting & Event Management'] },
      { rank: 'Nice-to-Have', requirementSkills: ['MS Office Proficiency'] },
    ]);
    expect(out).toEqual([
      { category: 'Core Competencies', items: ['Governance Process Ownership', 'Executive Support'] },
      { category: 'Supporting Expertise', items: ['Meeting & Event Management'] },
      { category: 'Additional Skills', items: ['MS Office Proficiency'] },
    ]);
  });

  it('prints a skill once, under its highest rank', () => {
    // The real shape of the Allianz lead: Important repeated almost all of
    // Core. Duplicating them across categories is what C4 §D forbids.
    const out = buildSkillsSection([
      { rank: 'Important', requirementSkills: ['Executive Support'] },
      { rank: 'Core', requirementSkills: ['Executive Support'] },
    ]);
    expect(out).toEqual([{ category: 'Core Competencies', items: ['Executive Support'] }]);
  });

  it('deduplicates case-insensitively', () => {
    const out = buildSkillsSection([
      { rank: 'Core', requirementSkills: ['Executive Support', 'executive support', 'EXECUTIVE SUPPORT'] },
    ]);
    expect(out).toEqual([{ category: 'Core Competencies', items: ['Executive Support'] }]);
  });

  it('omits empty categories rather than printing a bare heading', () => {
    const out = buildSkillsSection([{ rank: 'Core', requirementSkills: ['Executive Support'] }]);
    expect(out.map((g) => g.category)).toEqual(['Core Competencies']);
  });

  it('keeps skills from an unranked requirement, last', () => {
    const out = buildSkillsSection([
      { rank: 'Core', requirementSkills: ['Executive Support'] },
      { rank: null, requirementSkills: ['Precise Written Communication'] },
    ]);
    expect(out).toEqual([
      { category: 'Core Competencies', items: ['Executive Support'] },
      { category: 'Additional Skills', items: ['Precise Written Communication'] },
    ]);
  });

  it('ignores blank and missing skill lists', () => {
    expect(buildSkillsSection([{ rank: 'Core', requirementSkills: null }, { rank: 'Core', requirementSkills: ['', '  '] }])).toEqual([]);
    expect(buildSkillsSection([])).toEqual([]);
  });

  it('never truncates Core or Important — only Nice-to-Have sheds', () => {
    const core = Array.from({ length: 30 }, (_, i) => `Core Skill ${i}`);
    const important = Array.from({ length: 10 }, (_, i) => `Important Skill ${i}`);
    const nice = Array.from({ length: 20 }, (_, i) => `Nice Skill ${i}`);
    const out = buildSkillsSection([
      { rank: 'Core', requirementSkills: core },
      { rank: 'Important', requirementSkills: important },
      { rank: 'Nice-to-Have', requirementSkills: nice },
    ]);
    const total = out.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(SKILLS_ENVELOPE);
    expect(out.find((g) => g.category === 'Core Competencies')!.items).toHaveLength(30);
    expect(out.find((g) => g.category === 'Supporting Expertise')!.items).toHaveLength(10);
    expect(out.find((g) => g.category === 'Additional Skills')).toBeUndefined();
  });

  it('stays inside the envelope even when Core alone overruns it', () => {
    // Core is never truncated, so this deliberately exceeds the envelope
    // rather than dropping evidence-backed Core skills. A JD that produces
    // this many is a B2 over-extraction, and it should be visible.
    const core = Array.from({ length: 50 }, (_, i) => `Core Skill ${i}`);
    const out = buildSkillsSection([{ rank: 'Core', requirementSkills: core }]);
    expect(out[0].items).toHaveLength(50);
  });

  it('reproduces the shape of the lead that produced the 67', () => {
    // 64 Keep rows, 2.6 Requirement Skills each, heavily shared across
    // requirements — the live data yields 16 distinct, all Core/Important.
    const pool = Array.from({ length: 16 }, (_, i) => `Skill ${i}`);
    const rows = Array.from({ length: 64 }, (_, i) => ({
      rank: i % 3 === 0 ? 'Important' : 'Core',
      requirementSkills: [pool[i % 16], pool[(i + 5) % 16], pool[(i + 9) % 16]],
    }));
    const out = buildSkillsSection(rows);
    expect(out.reduce((n, g) => n + g.items.length, 0)).toBe(16);
  });
});
