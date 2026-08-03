/**
 * B6's evidence side (CI · B6 Never Receives the Master Bullet Bank).
 *
 * Three things this locks down, each of which was a defect in §1:
 *
 *  1. `bulletBankVersionOf` — the provenance stamp must describe the bank that was
 *     actually sent. It was a hardcoded `'2026-06'` literal written by a step that
 *     had never been sent a bank, so the column asserted a fact about every one of
 *     157 leads that was not true of any of them.
 *  2. `renderB6Evidence` — every ref code must reach the model, and an owner with
 *     no bank must be TOLD there is no bank rather than silently scored against
 *     nothing. That silence is what made "No Match" unreadable: "no evidence
 *     exists" and "no evidence was supplied" produced identical output.
 *  3. `resolveEvidenceLinks` — a citation that isn't in the bank is a fabricated
 *     one, and NON_NEGOTIABLES says we never let one through.
 *
 * All three are pure functions, deliberately: vitest here runs on plain node — no
 * DB, no network, no LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  bulletBankVersionOf,
  matchB6Judgments,
  renderB6Evidence,
  resolveEvidenceLinks,
  type B6Evidence,
} from '../pipeline/screening';
import { B6 } from '../llm/schemas';

const ev = (ref: string, over: Partial<B6Evidence> = {}): B6Evidence => ({
  ref,
  kind: 'Bullet',
  text: `text for ${ref}`,
  tags: [],
  cvPosition: null,
  ...over,
});

/**
 * The sibling CI's defect, locked mechanically. Under `strict: true` the tool
 * input is grammar-constrained and a PARTIAL `required` list degrades that grammar
 * rather than making the missing fields optional — measured on B2 at 0-1
 * requirements across 17 consecutive real JDs with three of seven listed, and
 * 13/14 once all seven were. `required` means "the key is present", not "the value
 * is non-empty", so listing everything costs nothing and omitting anything is a
 * silent generation collapse waiting to happen.
 */
describe('B6 tool schema: every property is required (strict-mode grammar)', () => {
  type Node = { properties: Record<string, { type?: string }>; required: string[] };
  const schema = B6.tool.input_schema as unknown as Node & { properties: { requirements: { items: Node } } };
  const reqItems = schema.properties.requirements.items;

  it('lists every root property', () => {
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it('lists every per-requirement property, including the new evidence fields', () => {
    expect([...reqItems.required].sort()).toEqual(Object.keys(reqItems.properties).sort());
    expect(reqItems.required).toContain('evidenceRefs');
    expect(reqItems.required).toContain('evidenceNote');
  });

  it('carries evidence as an array — one requirement is routinely met by several bullets', () => {
    expect(reqItems.properties.evidenceRefs.type).toBe('array');
  });

  it('accepts an unsupported requirement without forcing a citation', () => {
    const parsed = B6.zod.parse({
      relevance: 5, seniority: 5, impact: 5, ats: 5,
      requirements: [
        { order: 1, requirement: 'SAP S/4HANA', score: 0, matchStrength: 'No Match', keyStrengths: '', gaps: 'No SAP exposure in the bank.', evidenceRefs: [], evidenceNote: '' },
      ],
      summary: '',
    });
    expect(parsed.requirements[0].evidenceRefs).toEqual([]);
  });
});

describe('bulletBankVersionOf: the stamp records what was actually sent', () => {
  it('reports the bank version when every row agrees', () => {
    expect(bulletBankVersionOf([{ version: '2026-06' }, { version: '2026-06' }])).toBe('2026-06');
  });

  it('is null for an empty bank — "no bank was consulted" must be readable off the row', () => {
    expect(bulletBankVersionOf([])).toBeNull();
  });

  it('never silently picks one version when the bank is mixed', () => {
    expect(bulletBankVersionOf([{ version: '2026-06' }, { version: '2025-11' }])).toBe('2025-11+2026-06');
  });

  it('distinguishes an unstamped bank from no bank at all', () => {
    expect(bulletBankVersionOf([{ version: null }, { version: '  ' }])).toBe('unversioned');
  });
});

describe('renderB6Evidence: the bank reaches the model', () => {
  const items = [
    ev('C1', { tags: ['Process Transformation'], text: 'Cut the month-end close from 20 days to 5.' }),
    ev('EDU-2', { kind: 'Education', text: "Master's in Economic Development, IUJ, 2006" }),
    ev('LANG-3', { kind: 'Language', text: 'German — C1' }),
  ];

  it('lists every ref code, so a citation can be verified rather than trusted', () => {
    const out = renderB6Evidence(items);
    for (const i of items) expect(out).toContain(`[${i.ref}]`);
    expect(out).toContain('Cut the month-end close from 20 days to 5.');
  });

  it('carries education and languages, which B6 §B.1.2 names explicitly', () => {
    const out = renderB6Evidence(items);
    expect(out).toContain('(Education)');
    expect(out).toContain('(Language)');
  });

  it('says so out loud when the owner has no bank, instead of scoring against silence', () => {
    const out = renderB6Evidence([]);
    expect(out).toMatch(/none on file/i);
    expect(out).toMatch(/do not invent evidence/i);
  });
});

describe('resolveEvidenceLinks: never persist a citation the bank cannot back', () => {
  const byRef = new Map([ev('C1'), ev('C4'), ev('EDU-1')].map((e) => [e.ref, e]));

  it('keeps every requirement→bullet pair — the mapping is many-to-many', () => {
    const { links } = resolveEvidenceLinks(
      [{ row: { id: 'req-1' }, refs: ['C1', 'C4'], note: 'both carry it' }],
      byRef
    );
    expect(links.map((l) => l.ev.ref)).toEqual(['C1', 'C4']);
    expect(links.every((l) => l.requirementId === 'req-1')).toBe(true);
  });

  it('drops a ref code that is not in the bank and reports it', () => {
    const { links, unknownRefs } = resolveEvidenceLinks(
      [{ row: { id: 'req-1' }, refs: ['C1', 'Z9'], note: null }],
      byRef
    );
    expect(links.map((l) => l.ev.ref)).toEqual(['C1']);
    expect(unknownRefs).toEqual(['Z9']);
  });

  it('de-duplicates a bullet cited twice for the same requirement', () => {
    const { links } = resolveEvidenceLinks([{ row: { id: 'req-1' }, refs: ['C1', ' C1 '], note: null }], byRef);
    expect(links).toHaveLength(1);
  });

  it('lets the same bullet serve several requirements — the other half of many-to-many', () => {
    const { links } = resolveEvidenceLinks(
      [
        { row: { id: 'req-1' }, refs: ['C1'], note: null },
        { row: { id: 'req-2' }, refs: ['C1'], note: null },
      ],
      byRef
    );
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.requirementId))).toEqual(new Set(['req-1', 'req-2']));
  });

  it('produces nothing for a requirement B6 could not support — an empty lane, not a forced link', () => {
    const { links, unknownRefs } = resolveEvidenceLinks([{ row: { id: 'req-1' }, refs: [], note: null }], byRef);
    expect(links).toHaveLength(0);
    expect(unknownRefs).toHaveLength(0);
  });
});

/**
 * The collapse guard (2026-08-02). B6 inherited B2's defect: `requirements` has no
 * floor in the zod schema, so a degraded generation returning one or two judgments is
 * schema-valid and runStructured's retry never fires. It stayed invisible because the
 * seating step backfilled every skipped row with `score ?? 6` → "Good" — a fabricated
 * middling rating that `requirementAlignment` then counted as a real one. An audit of
 * the back catalogue found two leads already stored that way (2 of 26, and 2 of 18).
 *
 * These lock the seating step's contract: a row with no judgment must come back `null`
 * so the caller can refuse to write it. The re-ask/throw around it lives in runScoring,
 * which needs a DB and a model and so is out of this file's reach.
 */
describe('matchB6Judgments: an unjudged requirement is null, never a fabricated default', () => {
  const rows = [{ requirement: 'A' }, { requirement: 'B' }, { requirement: 'C' }];
  const j = (order: number | undefined, requirement: string) => ({ order, requirement });

  it('seats a full answer by order', () => {
    const out = matchB6Judgments([j(3, 'C'), j(1, 'A'), j(2, 'B')], rows);
    expect(out.map((x) => x?.requirement)).toEqual(['A', 'B', 'C']);
  });

  it('reports the collapse — two judgments for three requirements leaves a null', () => {
    const out = matchB6Judgments([j(1, 'A'), j(2, 'B')], rows);
    expect(out.map((x) => x?.requirement)).toEqual(['A', 'B', undefined]);
    expect(out.filter((x) => x == null)).toHaveLength(1);
  });

  it('reports the severe collapse the audit found — one judgment, the rest null', () => {
    const out = matchB6Judgments([j(1, 'A')], rows);
    expect(out.filter((x) => x == null)).toHaveLength(2);
  });

  it('is all-null when the model returns an empty array, not silently scored', () => {
    expect(matchB6Judgments([], rows).every((x) => x == null)).toBe(true);
  });

  it('falls back to matching text when the model omits order', () => {
    const out = matchB6Judgments([j(undefined, 'C'), j(undefined, 'A'), j(undefined, 'B')], rows);
    expect(out.map((x) => x?.requirement)).toEqual(['A', 'B', 'C']);
  });

  it('falls back to position when order is absent and the text was reworded', () => {
    const out = matchB6Judgments([j(undefined, 'A (reworded)'), j(undefined, 'B!'), j(undefined, 'C?')], rows);
    expect(out.map((x) => x?.requirement)).toEqual(['A (reworded)', 'B!', 'C?']);
  });

  it('does not let one duplicated order swallow the other rows', () => {
    // Same `order` twice collapses the map; text and position still seat the rest.
    const out = matchB6Judgments([j(1, 'A'), j(1, 'B'), j(3, 'C')], rows);
    expect(out.filter((x) => x == null)).toHaveLength(0);
  });

  it('has nothing to judge — and so nothing unjudged — when the lead has no requirements', () => {
    expect(matchB6Judgments([j(1, 'A')], [])).toEqual([]);
  });
});
