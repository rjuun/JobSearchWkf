/**
 * C7 (high-fidelity path): fill the owner's real 2-page Word template
 * (Group CVs/CV_Template.docx) with docxtemplater instead of rebuilding the
 * layout programmatically. The template carries 11 `<<Professional Experience -
 * … >>` placeholders keyed to the methodology's cv_position values, plus a
 * `<<Profile>>` placeholder filled by the tailored C6 profile. Skills, education
 * and languages are filled from real data too — see `templateSlotData`.
 *
 * Correction, 2026-08-24: this comment used to say those three were "the
 * template's curated scaffold (fixed by design; role-dynamic skills need the
 * skill_category taxonomy — see ROADMAP P6)". Both halves are stale. They stopped
 * being a fixed scaffold when the data-driven wiring shipped, and ROADMAP P6 is
 * the `approval_status` rename plus per-tenant templates — it never mentioned
 * skills. The real record of the `skill_category` gap is
 * `docs/archive/phases/P3-tailoring.md`, which logged it as unbuilt, not deferred.
 * Live work: CI · C4 Skills Selection Produces Unreadable Overflow §2.11.
 *
 * docxtemplater's default parser would choke on tags containing spaces / dots /
 * dashes, so we use `<<`…`>>` delimiters with a custom parser that treats the
 * whole tag as a literal key into the data map, and a nullGetter that blanks any
 * unmapped slot rather than throwing.
 *
 * Correction, 2026-08-27 (CI · CV Template Output Format §2.6): the data was a
 * flat `Record<string, string>` and multi-line values were joined with `\n`.
 * That could not work, and four of the owner's six format complaints were the
 * one consequence: docxtemplater substitutes a value INTO the paragraph its
 * placeholder sits in, so a `\n` is a line break *within one paragraph* — and
 * Word applies list formatting, bold runs and tab stops PER PARAGRAPH. Three
 * bullets rendered as one bulleted paragraph with two soft breaks (measured, not
 * assumed: the probe put three `<w:t>` runs and two `<w:br/>` inside a single
 * `<w:p>` carrying one `<w:numPr>`).
 *
 * So the template now owns the repeating paragraph and the data supplies values:
 * `<<#tag>>` … `<</tag>>` loops, with `<<.>>` for a bare string item. The parser
 * below gained exactly one line for it. `scripts/retag-cv-template.ts` is the
 * record of which paragraphs were re-tagged and why.
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { applyDocumentIdentity, dropUnreferencedImages, stripSharePointBindings } from './metadata';
import { applyHeadshot } from './render-assets';
export { CV_SLOTS, slotCode, normalizeCvPosition, type CvSlot } from '../cv-slots';

export const TEMPLATE_PATH = path.join(process.cwd(), 'Group CVs', 'CV_Template.docx');

export function templateExists(): boolean {
  try {
    return fs.existsSync(TEMPLATE_PATH);
  } catch {
    return false;
  }
}

/**
 * What a slot may hold. A plain string still fills a single paragraph; an array
 * drives a `<<#slot>>` loop, one paragraph per element — of bare strings for a
 * `<<.>>` body, or of objects whose keys are the tags inside the loop.
 */
export type TemplateValue = string | string[] | Record<string, string | string[]>[];
export type TemplateData = Record<string, TemplateValue>;

/** Who the finished document says wrote it. Omitted, the package keeps whatever
 *  the template carried — which is the template's author, its creation date and a
 *  word count for a different document. See `lib/docx/metadata.ts`. */
export type CvIdentity = { author: string };

/** Render the real template. `data` keys are the full slot strings above. */
export function buildCvFromTemplate(data: TemplateData, identity?: CvIdentity): Buffer {
  const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '<<', end: '>>' },
    paragraphLoop: true,
    linebreaks: true,
    // Raw-tag parser: the tag IS the key (no expression evaluation). `<<.>>` is
    // docxtemplater's "the loop item itself", which is how a loop over bare
    // strings — one bullet, one language — addresses its element.
    parser: (tag: string) => ({
      get: (scope: Record<string, unknown>) => (tag === '.' ? scope : scope?.[tag] ?? ''),
    }),
    nullGetter: () => '',
  });
  doc.render(data);

  // Everything below operates on the rendered package, not the template — the
  // headshot has to be gone from `document.xml` before its JPEG can be identified
  // as unreferenced, and the statistics have to be counted off the filled text.
  const out = doc.getZip() as PizZip;
  // Order matters: the real photograph goes in only while the drawing still
  // references it, and the unreferenced-image sweep runs after, so a CV rendered
  // without a headshot carries no photograph in its package at all.
  applyHeadshot(out);
  dropUnreferencedImages(out);
  if (identity) {
    applyDocumentIdentity(out, identity);
    stripSharePointBindings(out);
  }
  return out.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
