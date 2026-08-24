/**
 * C4's collapse floor.
 *
 * The defect being guarded: `generateCv` used to write
 * `matched?.bullet || row.originalText || ''`, so a C4 call that returned no
 * bullet for a ref silently stored the row's RAW, untailored evidence text as
 * `cv_bullet`. Nothing errored, nothing was empty, the .docx rendered — the CV
 * just said the candidate's generic evidence instead of anything tailored to the
 * job. Structurally the same as B6's `j?.score ?? 6` before its guard, which is
 * why these tests mirror `matchB6Judgments`': the interesting behaviour is what
 * counts as an answer, and it has to be provable without Postgres or an API key.
 */
import { describe, it, expect } from 'vitest';
import { absorbC4Bullets, missingC4Refs, c4UserMessage, type C4Bullet } from '../pipeline/tailoring';

const rows = (...refs: (string | null)[]) => refs.map((evidenceRef) => ({ evidenceRef }));
const fresh = () => new Map<string, { bullet: string; skills: string[] }>();

describe('absorbC4Bullets: what counts as a rewrite', () => {
  it('records a real bullet against its ref', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: 'Led the thing.', skills: ['Governance'] }]);
    expect(m.get('5-3')).toEqual({ bullet: 'Led the thing.', skills: ['Governance'] });
  });

  it('trims surrounding whitespace', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: '  Led the thing.  ' }]);
    expect(m.get('5-3')?.bullet).toBe('Led the thing.');
  });

  it('defaults absent skills to an empty array rather than undefined', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: 'A-R3', bullet: 'Owned the plan.' }]);
    expect(m.get('A-R3')?.skills).toEqual([]);
  });

  // The whole point of the floor. `bullet` is required in the strict schema, so
  // a degraded call returns the KEY holding "" — the C2 `placeholder` failure
  // one step over. Recording that would satisfy the floor with nothing in it.
  it('does NOT accept an empty bullet as an answer', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: '' }]);
    expect(m.has('5-3')).toBe(false);
  });

  it('does NOT accept a whitespace-only bullet as an answer', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: '   \n  ' }]);
    expect(m.has('5-3')).toBe(false);
  });

  it('ignores an entry with no ref', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '', bullet: 'Orphaned bullet.' }]);
    expect(m.size).toBe(0);
  });

  it('accumulates across re-asks, so attempt 2 only has to cover what attempt 1 missed', () => {
    const m = fresh();
    absorbC4Bullets(m, [{ ref: '5-3', bullet: 'First.' }]);
    absorbC4Bullets(m, [{ ref: 'A-R3', bullet: 'Second.' }]);
    expect([...m.keys()].sort()).toEqual(['5-3', 'A-R3']);
  });

  it('lets a later real bullet replace an earlier one for the same ref', () => {
    const m = fresh();
    absorbC4Bullets(m, [{ ref: '5-3', bullet: 'Draft.' }]);
    absorbC4Bullets(m, [{ ref: '5-3', bullet: 'Better draft.' }]);
    expect(m.get('5-3')?.bullet).toBe('Better draft.');
  });
});

describe('missingC4Refs: which Keep rows C4 still owes', () => {
  it('is empty when every ref-bearing row got a bullet', () => {
    const m = absorbC4Bullets(fresh(), [
      { ref: '5-3', bullet: 'One.' },
      { ref: 'A-R3', bullet: 'Two.' },
    ]);
    expect(missingC4Refs(rows('5-3', 'A-R3'), m)).toEqual([]);
  });

  it('names the refs that got nothing', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: 'One.' }]);
    expect(missingC4Refs(rows('5-3', 'A-R3', 'EDU-1'), m)).toEqual(['A-R3', 'EDU-1']);
  });

  // The collapse this guard exists for: one bullet returned for a long Keep set.
  it('catches a collapsed reply that answered a single row', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: 'Only one.' }]);
    expect(missingC4Refs(rows('5-3', '5-4', '5-5', 'A-R3', 'A-R5'), m)).toHaveLength(4);
  });

  it('catches a reply that returned every ref but filled them with blanks', () => {
    const m = absorbC4Bullets(
      fresh(),
      rows('5-3', 'A-R3').map((r): C4Bullet => ({ ref: r.evidenceRef as string, bullet: '' }))
    );
    expect(missingC4Refs(rows('5-3', 'A-R3'), m)).toEqual(['5-3', 'A-R3']);
  });

  // C4 is keyed by ref, so a row without one was never answerable. Counting it
  // would make the floor unsatisfiable rather than strict.
  it('excludes rows that carry no evidenceRef', () => {
    const m = absorbC4Bullets(fresh(), [{ ref: '5-3', bullet: 'One.' }]);
    expect(missingC4Refs(rows('5-3', null, null), m)).toEqual([]);
  });

  it('counts a duplicated ref once', () => {
    expect(missingC4Refs(rows('5-3', '5-3', '5-3'), fresh())).toEqual(['5-3']);
  });

  it('is empty for an all-ref-less Keep set, so those leads still generate', () => {
    expect(missingC4Refs(rows(null, null), fresh())).toEqual([]);
  });

  it('ignores extra refs the model volunteered that no Keep row asked for', () => {
    const m = absorbC4Bullets(fresh(), [
      { ref: '5-3', bullet: 'Asked for.' },
      { ref: 'Z-9', bullet: 'Nobody asked.' },
    ]);
    expect(missingC4Refs(rows('5-3'), m)).toEqual([]);
  });
});

/**
 * CI · C3 Writes CV-Grade Skill Tags §1.2 — C4 had never been sent
 * `skills_master`. Pinned here because the prompt IS the deliverable of that CI,
 * and the only other way to read it is to run the pipeline against Postgres.
 */
describe('c4UserMessage: the register C4 writes in', () => {
  const ROWS = [{ evidenceRef: '5-3', requirementLine: 'Govern the board calendar', originalText: 'Ran it.', mySkills: ['Corporate Governance'] }];
  const REGISTER = [
    { name: 'Target Operating Model Design', source: 'skill' as const, proficiency: 'Expert', variants: ['TOM design', 'operating model'] },
    { name: 'Corporate Governance', source: 'skill' as const, proficiency: 'Expert', variants: [] },
  ];

  it('sends the register as its own cached block', () => {
    const blocks = c4UserMessage(ROWS, 'Head of Governance', null, null, REGISTER);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks[0].text).toContain('Target Operating Model Design');
    // The ATS variants come too — they are half of what makes the table a
    // register rather than a word list.
    expect(blocks[0].text).toContain('TOM design');
  });

  it('says the register is an exemplar, not a list to choose from (§2.2)', () => {
    // Building this as a lookup is the documented way to get this CI wrong, so
    // the prompt has to rule it out in as many words.
    const blocks = c4UserMessage(ROWS, 'Head of Governance', null, null, REGISTER);
    expect(blocks[0].text).toContain('not a list to choose from');
    expect(blocks[0].text).toMatch(/coin a name in the same register/i);
  });

  it('omits the block entirely when the profile has no skills_master rows', () => {
    // A tenant with an empty table gets the old prompt, not an empty heading
    // implying the register is empty.
    const blocks = c4UserMessage(ROWS, 'Head of Governance', null, null, []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toBeUndefined();
  });

  it('keeps every row addressable by ref, with its own My Skills', () => {
    const blocks = c4UserMessage(ROWS, 'Head of Governance', 'Governance', 'Workday', REGISTER);
    expect(blocks[1].text).toContain('[5-3] requirement: Govern the board calendar');
    expect(blocks[1].text).toContain('my skills: Corporate Governance');
    expect(blocks[1].text).toContain('ATS: Workday');
  });
});
