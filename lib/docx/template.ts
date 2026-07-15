/**
 * C6 (high-fidelity path): fill the owner's real 2-page Word template
 * (Group CVs/CV_Template.docx) with docxtemplater instead of rebuilding the
 * layout programmatically. The template carries 11 `<<Professional Experience -
 * … >>` placeholders keyed to the methodology's cv_position values, plus a
 * `<<Profile>>` placeholder filled by the tailored C5 profile. The skills block,
 * education and languages are the template's curated scaffold (fixed by design;
 * role-dynamic skills need the skill_category taxonomy — see ROADMAP P6).
 *
 * docxtemplater's default parser would choke on tags containing spaces / dots /
 * dashes, so we use `<<`…`>>` delimiters with a custom parser that treats the
 * whole tag as a literal key into the data map, and a nullGetter that blanks any
 * unmapped slot rather than throwing.
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
export { CV_SLOTS, slotCode, normalizeCvPosition, type CvSlot } from '../cv-slots';

export const TEMPLATE_PATH = path.join(process.cwd(), 'Group CVs', 'CV_Template.docx');

export function templateExists(): boolean {
  try {
    return fs.existsSync(TEMPLATE_PATH);
  } catch {
    return false;
  }
}

/** Render the real template. `data` keys are the full slot strings above. */
export function buildCvFromTemplate(data: Record<string, string>): Buffer {
  const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '<<', end: '>>' },
    paragraphLoop: true,
    linebreaks: true,
    // Raw-tag parser: the tag IS the key (no expression evaluation).
    parser: (tag: string) => ({ get: (scope: Record<string, unknown>) => scope[tag] ?? '' }),
    nullGetter: () => '',
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
