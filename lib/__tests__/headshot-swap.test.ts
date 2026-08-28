/**
 * The headshot swap has to survive Word renumbering the package.
 *
 * It did not, once. `scripts/retag-cv-template.ts` wrote the photograph to
 * `word/media/cv-headshot.jpeg` and this module looked it up by that name. The
 * template was later opened and saved in Word, which renumbers every media part
 * on its way out; the file became `word/media/image1.jpeg`, the lookup missed,
 * and `applyHeadshot` returned early. No error, no warning — every CV rendered
 * with the grey placeholder instead of the owner's face, and it was caught only
 * by looking at a rendered page.
 *
 * So the lookup goes through the drawing's `name`, which is authored content and
 * survives the round trip. These tests pin that, and pin the silence too: a swap
 * that cannot happen has to say so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import PizZip from 'pizzip';
import { applyHeadshot, HEADSHOT_ASSET_PATH } from '../docx/render-assets';

const REAL = Buffer.from('REAL-PHOTOGRAPH-BYTES');
const PLACEHOLDER = Buffer.from('placeholder');

/** A package shaped like the template: a drawing named "Headshot" embedding a
 *  relationship, which points at whatever the media part is currently called. */
function pkg(mediaPart: string, rId = 'rId8'): PizZip {
  const zip = new PizZip();
  zip.file(
    'word/document.xml',
    `<w:document><w:body><w:p><w:r><w:drawing><wp:anchor><wp:docPr id="1" name="Headshot"/>` +
      `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic>` +
      `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships><Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaPart}"/></Relationships>`
  );
  zip.file(`word/${mediaPart}`, PLACEHOLDER, { binary: true });
  return zip;
}

/** A package for a CV C1 decided against a headshot for: the loop removed the
 *  drawing, so nothing is named "Headshot" any more. */
function pkgWithoutDrawing(): PizZip {
  const zip = new PizZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p/></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<Relationships/>');
  zip.file('word/media/image1.jpeg', PLACEHOLDER, { binary: true });
  return zip;
}

beforeEach(() => {
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === HEADSHOT_ASSET_PATH);
  vi.spyOn(fs, 'statSync').mockReturnValue({ size: REAL.length } as ReturnType<typeof fs.statSync>);
  vi.spyOn(fs, 'readFileSync').mockReturnValue(REAL as unknown as string);
});
afterEach(() => vi.restoreAllMocks());

describe('applyHeadshot', () => {
  it('swaps the real photograph in under the name the re-tag script wrote', () => {
    const zip = pkg('media/cv-headshot.jpeg');
    const notices = applyHeadshot(zip);
    expect(zip.file('word/media/cv-headshot.jpeg')!.asText()).toBe(REAL.toString());
    expect(notices.join()).toMatch(/swapped/);
  });

  // The regression. Word renumbers media parts on save; the drawing's name does
  // not move, so resolving through it still finds the part.
  it('still finds the part after Word has renumbered it to image1.jpeg', () => {
    const zip = pkg('media/image1.jpeg');
    applyHeadshot(zip);
    expect(zip.file('word/media/image1.jpeg')!.asText()).toBe(REAL.toString());
  });

  it('follows the relationship id rather than assuming one', () => {
    const zip = pkg('media/image4.jpeg', 'rId42');
    applyHeadshot(zip);
    expect(zip.file('word/media/image4.jpeg')!.asText()).toBe(REAL.toString());
  });

  // A no-headshot CV: nothing to swap, and nothing to say. The photograph must
  // NOT be written in — `dropUnreferencedImages` is about to delete the part, and
  // putting his face there first would briefly place it in a document that must
  // not carry it.
  it('does nothing when the drawing is gone', () => {
    const zip = pkgWithoutDrawing();
    expect(applyHeadshot(zip)).toEqual([]);
    expect(zip.file('word/media/image1.jpeg')!.asText()).toBe(PLACEHOLDER.toString());
  });

  it('says so, loudly, when the asset is missing and the placeholder ships', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const zip = pkg('media/image1.jpeg');
    const notices = applyHeadshot(zip);
    expect(notices.join()).toMatch(/PLACEHOLDER/);
    expect(zip.file('word/media/image1.jpeg')!.asText()).toBe(PLACEHOLDER.toString());
  });
});
