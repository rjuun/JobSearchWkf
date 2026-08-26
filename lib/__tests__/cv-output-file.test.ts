/**
 * CI · CV Template Output Format — what the finished file is called, and what it
 * admits about where it came from.
 *
 * Both are things nobody looks at until a recruiter does. The filename is the
 * first thing they see in an inbox; the properties are the first thing an
 * automated screen reads.
 */
import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import { cvFileName, filingName, applyDocumentIdentity } from '../docx/metadata';

describe('filingName', () => {
  it('keeps first and last whole and initialises the middle', () => {
    expect(filingName('Reginaldo (Reggie) Silva Junior')).toBe('Reginaldo S Junior');
  });

  it('drops a nickname in brackets — it belongs on the CV, not in a filename', () => {
    expect(filingName('Ana (Aninha) Costa Pereira Lima')).toBe('Ana C P Lima');
  });

  it('leaves a two-part name alone rather than initialising half of it', () => {
    expect(filingName('Maria Silva')).toBe('Maria Silva');
  });

  it('falls back rather than producing an empty name', () => {
    expect(filingName('')).toBe('CV');
    expect(filingName(null)).toBe('CV');
  });
});

describe('cvFileName', () => {
  it('is the owner filing convention', () => {
    expect(cvFileName({ name: 'Reginaldo (Reggie) Silva Junior', position: 'Head of Strategy', company: 'Vestas' })).toBe(
      'CV - Reginaldo S Junior - Head of Strategy - Vestas.docx'
    );
  });

  // A job title is scraped text and routinely arrives with a slash in it
  // ("Senior/Principal Consultant") — which on Windows is a path separator, not a
  // character. Every filesystem-reserved character goes.
  it('replaces characters a filesystem would refuse', () => {
    const f = cvFileName({ name: 'A B', position: 'Senior/Principal Consultant (m/f/d)', company: 'Allianz: Services' });
    expect(f).not.toMatch(/[\\/:*?"<>|]/);
    expect(f).toContain('Senior-Principal Consultant (m-f-d)');
  });

  it('collapses the separator instead of leaving a gap when a piece is missing', () => {
    expect(cvFileName({ name: 'A B', position: null, company: 'Vestas' })).toBe('CV - A B - Vestas.docx');
    expect(cvFileName({ name: 'A B', position: null, company: null })).toBe('CV - A B.docx');
  });

  it('caps the length — these land in a Downloads folder several levels deep', () => {
    const f = cvFileName({ name: 'A B', position: 'x'.repeat(300), company: 'y'.repeat(300) });
    expect(f.length).toBeLessThanOrEqual(155);
    expect(f.endsWith('.docx')).toBe(true);
  });
});

/** A package with exactly the properties the real template carries. */
function fixture(): PizZip {
  const zip = new PizZip();
  zip.file(
    'docProps/core.xml',
    '<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t" xmlns:xsi="x">' +
      '<dc:creator>Un-named</dc:creator><cp:lastModifiedBy>Someone Else</cp:lastModifiedBy><cp:revision>8</cp:revision>' +
      '<cp:lastPrinted>2026-06-23T19:35:00Z</cp:lastPrinted>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-07-02T19:08:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-25T12:44:00Z</dcterms:modified></cp:coreProperties>'
  );
  zip.file(
    'docProps/app.xml',
    '<?xml version="1.0"?><Properties xmlns="p"><Template>Normal.dotm</Template><TotalTime>0</TotalTime>' +
      '<Pages>2</Pages><Words>201</Words><Characters>1273</Characters><Application>Microsoft Office Word</Application>' +
      '<Lines>10</Lines><Paragraphs>2</Paragraphs><CharactersWithSpaces>1470</CharactersWithSpaces></Properties>'
  );
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>one two three</w:t></w:r></w:p><w:p><w:r><w:t>four five</w:t></w:r></w:p></w:body></w:document>');
  return zip;
}

describe('applyDocumentIdentity', () => {
  it('names the owner as author and as last editor', () => {
    const zip = fixture();
    applyDocumentIdentity(zip, { author: 'r.juun@outlook.com' });
    const core = zip.file('docProps/core.xml')!.asText();
    expect(core).toContain('<dc:creator>r.juun@outlook.com</dc:creator>');
    expect(core).toContain('<cp:lastModifiedBy>r.juun@outlook.com</cp:lastModifiedBy>');
  });

  // The loudest signal, and the one nobody had looked at: every CV ever generated
  // carried the TEMPLATE's creation date, so a batch of applications shared one
  // frozen provenance and a "modified" that could predate the job posting.
  it('replaces the template\'s frozen dates with this render\'s own', () => {
    const zip = fixture();
    const now = new Date('2026-09-01T10:00:00Z');
    applyDocumentIdentity(zip, { author: 'a@b.c', now });
    const core = zip.file('docProps/core.xml')!.asText();
    expect(core).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-01T10:00:00Z</dcterms:modified>');
    expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-01T09:58:00Z</dcterms:created>');
    expect(core).not.toContain('2026-07-02');
    expect(core).toContain('<cp:revision>2</cp:revision>');
  });

  it('drops a print date nobody set', () => {
    const zip = fixture();
    applyDocumentIdentity(zip, { author: 'a@b.c' });
    expect(zip.file('docProps/core.xml')!.asText()).not.toContain('lastPrinted');
  });

  // app.xml claimed 201 words for a document that has far more, because Word
  // writes those on save and never recomputes them for a file it did not write.
  it('recomputes the statistics off the document instead of the template', () => {
    const zip = fixture();
    applyDocumentIdentity(zip, { author: 'a@b.c' });
    const app = zip.file('docProps/app.xml')!.asText();
    expect(app).toContain('<Words>5</Words>');
    expect(app).toContain('<Paragraphs>2</Paragraphs>');
    expect(app).not.toContain('201');
  });

  it('removes the counts it cannot honestly derive rather than leaving them wrong', () => {
    const zip = fixture();
    applyDocumentIdentity(zip, { author: 'a@b.c' });
    const app = zip.file('docProps/app.xml')!.asText();
    expect(app).not.toMatch(/<Pages>/);
    expect(app).not.toMatch(/<Lines>/);
    // Word is still the application that will open it, and says so.
    expect(app).toContain('<Application>Microsoft Office Word</Application>');
  });
});
