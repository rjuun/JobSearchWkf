/**
 * CI · STAR Results Never Reach the Evidence Graph.
 *
 * The defect: `gatherEvidence` queried five tables and omitted `star_results`,
 * so the 22 rows holding every quantified outcome the candidate has were never
 * citable. C2 could not cite one, so no CV was ever built on one — while
 * `Process/C4…` §B.4 went on instructing the bullet step to include measurable
 * results "when they exist in the Original Text", over evidence the
 * measurements had been withheld from.
 *
 * `gatherEvidence` itself needs Postgres and is verified against the live
 * profile (§2.5). What is pinned here is the half that has to survive without
 * it: that a result's `context` — the STAR the outcome came out of — actually
 * reaches BOTH prompts, and that it stays context rather than turning into a
 * second citable identity. Same reasoning as the C4 register tests next door:
 * the prompt is the deliverable, and a prompt readable only by running the
 * pipeline against a database cannot be pinned.
 */
import { describe, it, expect } from 'vitest';
import { c2UserMessage, c4UserMessage, type Evidence } from '../pipeline/tailoring';

const RESULT: Evidence = {
  ref: '1-R3',
  kind: 'STAR result',
  text: 'Gradual branch FTE reallocation from back-office to front-office over 6 years following SCE go-live. — measured: 6 years transition',
  skills: [],
  cvPosition: null,
  source: 'authored',
  context: 'outcome of STAR 1: Establishment of a Servicing Center in Portugal',
};
const ACTION: Evidence = {
  ref: '1-6',
  kind: 'STAR action',
  text: 'Toured six European branches to migrate services.',
  skills: ['Change Management'],
  cvPosition: null,
  source: 'imported',
};

const REQS: [number, { rank: string | null; requirement: string }][] = [
  [1, { rank: 'Core', requirement: 'Deliver shared-services transformation' }],
];

describe('c2UserMessage: STAR results in the evidence listing', () => {
  it('lists a result by its own ref and kind, like any other evidence node', () => {
    const [graph] = c2UserMessage([ACTION, RESULT], 'Head of Governance', null, REQS);
    expect(graph.text).toContain('[1-R3] (STAR result) Gradual branch FTE reallocation');
  });

  it('carries the metric the row records, so the number reaches the model', () => {
    // [2-R1]'s sentence names the branches consolidated and never says
    // "EUR 1.5B" — the figure only exists in `metric`. Dropping the column
    // would leave C2 mapping impact requirements against unquantified text,
    // which is the defect this CI exists to close.
    const [graph] = c2UserMessage([RESULT], 'Head of Governance', null, REQS);
    expect(graph.text).toContain('— measured: 6 years transition');
  });

  it('renders context on its own indented line, not inside the citable text', () => {
    // The ref in brackets is the only thing C2 may cite. Folding the STAR title
    // into `text` would make a composite claim traceable to no single row —
    // the reason §2.2 rejected a pre-joined action→result evidence item.
    const [graph] = c2UserMessage([RESULT], 'Head of Governance', null, REQS);
    expect(graph.text).toContain('\n    outcome of STAR 1: Establishment of a Servicing Center in Portugal');
    expect(graph.text).not.toContain('go-live. — measured: 6 years transition outcome of STAR');
  });

  it('leaves evidence without context exactly as it was', () => {
    // Every other kind passes no context; none of their lines may grow.
    const [graph] = c2UserMessage([ACTION], 'Head of Governance', null, REQS);
    expect(graph.text).toBe(
      'CANDIDATE EVIDENCE (cite by exact ref code):\n[1-6] (STAR action) Toured six European branches to migrate services.'
    );
  });
});

describe('c4UserMessage: the context line a result is written from', () => {
  const base = { requirementLine: 'Deliver shared-services transformation', mySkills: ['Programme Delivery'] };

  it('gives C4 the STAR the outcome came out of, so the bullet has an actor', () => {
    // Without this, C4 sees "Gradual branch FTE reallocation… following SCE
    // go-live" and is asked (§B.3) to open on a strong action verb over a
    // sentence that names nobody who acted.
    const blocks = c4UserMessage(
      [{ ...base, evidenceRef: '1-R3', originalText: RESULT.text, context: RESULT.context }],
      'Head of Governance',
      null,
      null,
      []
    );
    expect(blocks[0].text).toContain('   context: outcome of STAR 1: Establishment of a Servicing Center in Portugal\n');
  });

  it('keeps context between the original text and My Skills', () => {
    const blocks = c4UserMessage(
      [{ ...base, evidenceRef: '1-R3', originalText: 'Outcome.', context: 'outcome of STAR 1: A project' }],
      'Head of Governance',
      null,
      null,
      []
    );
    expect(blocks[0].text).toContain(
      '[1-R3] requirement: Deliver shared-services transformation\n   original: Outcome.\n' +
        '   context: outcome of STAR 1: A project\n   my skills: Programme Delivery'
    );
  });

  it('omits the line entirely for rows that have no context', () => {
    // A STAR action, responsibility or bullet must reach C4 in exactly the
    // shape it did before this CI — an empty `context:` label would read as a
    // context the row is missing rather than one it never had.
    const blocks = c4UserMessage(
      [{ ...base, evidenceRef: '1-6', originalText: 'Toured six European branches.' }],
      'Head of Governance',
      null,
      null,
      []
    );
    expect(blocks[0].text).toContain('   original: Toured six European branches.\n   my skills: Programme Delivery');
    expect(blocks[0].text).not.toContain('context:');
  });
});
