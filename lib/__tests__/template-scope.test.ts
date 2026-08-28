/**
 * Tag resolution across loop boundaries, rendered against the REAL template.
 *
 * THE BUG THIS EXISTS FOR
 * The raw-tag parser resolved a tag against the current scope and returned `''`
 * when it was not there. That reads as harmless until a loop wraps a tag that
 * belongs to the scope OUTSIDE it. CI · Never Render a Position Header Over
 * Nothing did exactly that: each position's header and dates got wrapped in
 * `<<#Position A Visible>>` … `<</Position A Visible>>`, whose element is the
 * marker string `'x'`. `<<Position A Header>>` then looked up a property of a
 * string, found nothing, and resolved to empty — INSTEAD of looking outward.
 *
 * Every position header and every date on every CV rendered blank, and nothing
 * failed, because a missing value and an empty one are the same thing to a
 * renderer. It was caught by diffing rendered XML against the previous version.
 *
 * The fix is one character: return `undefined`, which is docxtemplater's signal
 * to walk out to the enclosing scope. `nullGetter` still blanks a tag that is
 * unmapped everywhere. These tests hold that line — against the real file,
 * because the defect lived in the seam between the template and the parser and
 * a hand-built fixture would not have had the loop in it.
 */
import { describe, it, expect } from 'vitest';
import { buildCvFromTemplate, templateExists } from '../docx/template';
import PizZip from 'pizzip';

/** Visible text of a rendered .docx, paragraph order preserved. */
function textOf(buf: Buffer): string {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/&amp;/g, '&');
}

const HEADER = 'Head of Governance & Strategy at Banco do Brasil AG, Vienna, Austria';
const DATES = 'Jul 2018 — Dec 2024';

describe.runIf(templateExists())('template tag resolution', () => {
  // The regression, stated as the thing a reader cares about: the header prints.
  it('resolves a tag from OUTSIDE the loop that wraps it', () => {
    const out = buildCvFromTemplate({
      'Position A Visible': ['x'],
      'Position A Header': HEADER,
      'Position A Dates': DATES,
    });
    const text = textOf(out);
    expect(text).toContain(HEADER);
    expect(text).toContain(DATES);
  });

  // The other half of the guard: the position is omitted, so nothing of it
  // prints — not the header, and not a blank paragraph where it used to be.
  it('omits the whole block when the position is not visible', () => {
    const out = buildCvFromTemplate({
      'Position A Visible': [],
      'Position A Header': HEADER,
      'Position A Dates': DATES,
    });
    expect(textOf(out)).not.toContain(HEADER);
  });

  // Guards the fix from being undone by "just default it to empty": a tag with
  // no value anywhere must still render blank rather than leaking its own name.
  it('blanks a tag that is mapped nowhere', () => {
    const text = textOf(buildCvFromTemplate({ 'Position A Visible': ['x'] }));
    expect(text).not.toContain('Position A Header');
    expect(text).not.toContain('undefined');
  });

  // Scope resolution must not reach outward THROUGH an item that has the key —
  // an Education entry's own `Dates` wins over anything of that name outside it.
  it('prefers the loop item own key over the enclosing scope', () => {
    const out = buildCvFromTemplate({
      Education: [{ Head: 'MSc Something, A University', Dates: 'Sep 2004 — Jun 2006', Status: [] }],
      Dates: 'SHOULD-NOT-APPEAR',
    });
    const text = textOf(out);
    expect(text).toContain('Sep 2004 — Jun 2006');
    expect(text).not.toContain('SHOULD-NOT-APPEAR');
  });
});
