/**
 * CI · Never Render a Position Header Over Nothing — the third re-tag of
 * `Group CVs/CV_Template.docx`.
 *
 * WHY A TEMPLATE CHANGE IS UNAVOIDABLE HERE
 * -----------------------------------------
 * The guard's interior case is pure data: force a role overview back in, and the
 * existing `<<#…A0. Role Overview>>` loop renders it. The TRAILING case is not.
 * A position's header (`<<Position D Header>><<Position D Dates>>`) and its
 * "Direct Reports: …" line are plain, unconditional paragraphs — supplying empty
 * strings leaves a blank paragraph and, on positions A and B, leaves the literal
 * "Direct Reports" text printing under nothing at all. A position cannot be
 * omitted from the data side; the paragraphs have to become conditional.
 *
 * So each position's header and its Direct Reports line are wrapped in
 * `<<#Position X Visible>>` … `<</Position X Visible>>`, fed by
 * `applyPositionGuard` in `lib/pipeline/tailoring.ts`. Every current lead sets
 * every position visible, so the rendered output does not move.
 *
 * COMPOSES ONTO THE OTHER TWO
 * `retag-cv-template.ts` runs against the original and refuses a retagged file;
 * `retag-cv-template-space.ts` runs against that one's output and refuses the
 * original. This runs against the space re-tag's output and refuses to
 * double-apply. None is idempotent on its own, and each says so.
 *
 *   npx tsx scripts/retag-cv-template-positions.ts [--dry-run]
 */
import fs from 'node:fs';
import PizZip from 'pizzip';
import { TEMPLATE_PATH } from '../lib/docx/template';
import { CV_SLOTS, slotCode } from '../lib/cv-slots';

const EN_GB = '<w:rPr><w:lang w:val="en-GB"/></w:rPr>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (t: string) => esc('<<' + t + '>>');
const marker = (t: string) => `<w:p><w:r>${EN_GB}<w:t xml:space="preserve">${tag(t)}</w:t></w:r></w:p>`;

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
  let xml = zip.file('word/document.xml')!.asText();
  const done: string[] = [];

  if (!xml.includes(esc('<<#Key Projects')) && !xml.includes(esc('<<#Position A Key Projects'))) {
    throw new Error(
      'This template has not had the space re-tag applied — no <<#Position … Key Projects>> loop found. ' +
        'Run scripts/retag-cv-template-space.ts first; this script composes onto its output.'
    );
  }
  if (xml.includes(esc('<<#Position A Visible'))) {
    throw new Error(
      'This template already carries the position-visibility tags. Re-running would double-apply. ' +
        'Restore it first: git checkout -- "Group CVs/CV_Template.docx"'
    );
  }

  function paragraphBounds(i: number): { start: number; end: number } {
    const start = Math.max(xml.lastIndexOf('<w:p ', i), xml.lastIndexOf('<w:p>', i));
    const end = xml.indexOf('</w:p>', i) + '</w:p>'.length;
    if (start === -1 || end < start) throw new Error(`Could not bound the paragraph at offset ${i}`);
    return { start, end };
  }

  /** The letters the CV renders, in document order — derived from CV_SLOTS so the
   *  re-tag and the guard agree on what a "position" is. */
  const letters = [...new Set(CV_SLOTS.map((s) => slotCode(s)[0]))];

  for (const letter of letters) {
    const needle = `<w:t>${tag(`Position ${letter} Header`)}`;
    const i = xml.indexOf(needle);
    if (i === -1) throw new Error(`Template no longer carries a <<Position ${letter} Header>> paragraph`);
    const header = paragraphBounds(i);

    // "Direct Reports: …" is static text belonging to this position, so it has to
    // go inside the wrap or it prints under an omitted header. Only A and B carry
    // one — the check is on the NEXT paragraph rather than on a list of letters,
    // so a position that gains or loses the line needs no change here.
    let end = header.end;
    const next = xml.slice(header.end, header.end + 4000);
    const dr = /^\s*<w:p[ >][\s\S]*?<\/w:p>/.exec(next);
    if (dr && /<w:t[^>]*>Direct Reports:/.test(dr[0])) {
      end = header.end + dr.index + dr[0].length;
      done.push(`Position ${letter} · header + Direct Reports`);
    } else {
      done.push(`Position ${letter} · header`);
    }

    const body = xml.slice(header.start, end);
    xml = xml.slice(0, header.start) + marker(`#Position ${letter} Visible`) + body + marker(`/Position ${letter} Visible`) + xml.slice(end);
  }

  for (const line of done) console.log(`  + ${line}`);
  if (dryRun) {
    console.log(`\n--dry-run: ${done.length} position block(s) wrapped, template not written.`);
    return;
  }
  zip.file('word/document.xml', xml);
  fs.writeFileSync(TEMPLATE_PATH, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer);
  console.log(`\nWrote ${TEMPLATE_PATH} — ${done.length} position block(s) wrapped.`);
}

main();
