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
  auditBulletTags,
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

describe('CV-grade tags · support (§2.4), which replaces the identity guard', () => {
  // One row's worth of material: the tailored bullet, plus what C3 was handed.
  const MATERIAL = [
    'Led the transfer pricing review across 14 entities, cutting allocated cost by 12%.',
    'Reported quarterly to the Management Board on regulatory compliance under the EBA framework.',
    'Cost Allocation',
    'Corporate Governance',
  ];

  it('keeps a coined compound the row supports — the whole point of this CI', () => {
    // Not in any table, not in `selected`, and rejected by the identity guard
    // this replaces. It is the benchmark's own wording.
    expect(auditBulletTags(['Transfer Pricing & Cost Optimization'], MATERIAL, []).kept).toEqual([
      'Transfer Pricing & Cost Optimization',
    ]);
  });

  it('keeps a parenthetical anchor the evidence carries', () => {
    expect(auditBulletTags(['Corporate Governance & Regulatory Compliance (EBA)'], MATERIAL, []).dropped).toEqual([]);
  });

  it('drops the orphan — a capability the row is not about at all', () => {
    const out = auditBulletTags(['Nuclear Engineering'], MATERIAL, []);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual(['Nuclear Engineering']);
  });

  it('does not let a generic word do the anchoring', () => {
    // "Management" appears on the row (Management Board) and proves nothing —
    // this is the shape a fabricated capability takes when it borrows a filler
    // word from the evidence.
    expect(auditBulletTags(['Nuclear Safety Management'], MATERIAL, []).dropped).toEqual(['Nuclear Safety Management']);
  });

  it('anchors across a spelling or inflection difference', () => {
    expect(auditBulletTags(['Regulatory Compliance Reporting'], MATERIAL, []).kept).toHaveLength(1);
    expect(auditBulletTags(['Cost Optimisation'], MATERIAL, []).kept).toHaveLength(1);
  });

  it('keeps re-expression, which no stricter lexical rule could', () => {
    // The owner's own CV: the curated `Confidentiality & Trust` printed as
    // "Confidentiality & Discretion". "Discretion" is in no source on the row.
    const out = auditBulletTags(
      ['Confidentiality & Discretion'],
      ['Handled board papers in strict confidentiality.', 'Confidentiality & Trust'],
      ['Confidentiality & Trust']
    );
    expect(out.kept).toEqual(['Confidentiality & Discretion']);
    expect(out.uncovered).toEqual([]);
  });

  it('collapses a tag repeated in two spellings', () => {
    const out = auditBulletTags(['Cost Allocation', 'cost   ALLOCATION', '', '  '], MATERIAL, []);
    expect(out.kept).toEqual(['Cost Allocation']);
  });
});

describe('CV-grade tags · coverage (§2.4), so a capability cannot vanish silently', () => {
  it('reports a My Skill no surviving tag recognises', () => {
    // `Resilience` + `Tolerance for Stress` → "Resilience & Composure Under
    // Pressure" is the owner's own re-expression. Resilience came through by
    // name; Tolerance for Stress came through by meaning only, and that is what
    // this counter is sensitive to. Reported, never dropped.
    const out = auditBulletTags(
      ['Resilience & Composure Under Pressure'],
      ['Held the programme together through two reorganisations.', 'Resilience', 'Tolerance for Stress'],
      ['Resilience', 'Tolerance for Stress']
    );
    expect(out.kept).toHaveLength(1);
    expect(out.uncovered).toEqual(['Tolerance for Stress']);
  });

  it('counts a My Skill against the surviving tags, not the proposed ones', () => {
    const out = auditBulletTags(['Nuclear Engineering'], ['Chaired the audit committee.'], ['Audit Coordination']);
    expect(out.dropped).toEqual(['Nuclear Engineering']);
    expect(out.uncovered).toEqual(['Audit Coordination']);
  });

  it('is silent when every My Skill is carried through', () => {
    expect(auditBulletTags(['Corporate Governance'], ['Ran the governance calendar.'], ['Corporate Governance']).uncovered).toEqual([]);
  });
});

describe('C4 §B.1 · reconcileSkillGroups accepts a supported compound (§2.4)', () => {
  const SELECTED = ['Cost Allocation', 'Cost Optimization', 'Corporate Governance'];

  it('prints a merged name that contains a selected skill, and consumes it', () => {
    const out = reconcileSkillGroups(SELECTED, [
      { category: 'Cost & Commercial', skills: ['Transfer Pricing & Cost Optimization'] },
      { category: 'Governance', skills: ['Corporate Governance'] },
    ]);
    expect(out[0].items).toEqual(['Transfer Pricing & Cost Optimization']);
    // Consumed, so the merge does not print beside the atom it absorbed.
    expect(out.flatMap((g) => g.items)).not.toContain('Cost Optimization');
    // The seam the consolidation CI meets: an atom the compound does not
    // literally contain is still owed a home.
    expect(out.at(-1)).toEqual({ category: 'Additional Skills', items: ['Cost Allocation'] });
  });

  it('refuses to print a merge beside a part it already placed', () => {
    const out = reconcileSkillGroups(SELECTED, [
      { category: 'A', skills: ['Cost Optimization'] },
      { category: 'B', skills: ['Transfer Pricing & Cost Optimization'] },
    ]);
    expect(JSON.stringify(out)).not.toContain('Transfer Pricing');
  });

  it('rejects atomisation — a name that drops a qualifier the row earned', () => {
    // "Governance" for the selected "Corporate Governance" is the failure this
    // CI exists to end, and it arrives looking exactly like a merge.
    const out = reconcileSkillGroups(['Corporate Governance'], [{ category: 'G', skills: ['Governance'] }]);
    expect(out).toEqual([{ category: 'Additional Skills', items: ['Corporate Governance'] }]);
  });

  it('still prints the selected spelling when the model merely respells one', () => {
    const out = reconcileSkillGroups(['Audit & Compliance Coordination'], [
      { category: 'G', skills: ['Audit and Compliance Coordination'] },
    ]);
    expect(out).toEqual([{ category: 'G', items: ['Audit & Compliance Coordination'] }]);
  });
});
