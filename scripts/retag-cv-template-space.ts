/**
 * CI · C7 Space Rules Are Specified and Never Enforced — the second re-tag of
 * `Group CVs/CV_Template.docx`.
 *
 * WHY A SECOND SCRIPT AND NOT AN EDIT TO THE FIRST
 * -----------------------------------------------
 * `scripts/retag-cv-template.ts` runs against the ORIGINAL template and refuses
 * to run against one that already carries loop tags — deliberately, so a re-run
 * cannot double-apply. This one is the opposite: it runs against the retagged
 * template and refuses the original. The two compose; neither is idempotent on
 * its own, and each says so.
 *
 * WHAT IT CHANGES, AND WHY IT IS THE PAGE LEVER
 * ---------------------------------------------
 * Three kinds of paragraph in Professional Experience were STATIC or
 * unconditional, and between them they made an empty slot impossible to render:
 *
 *   • the project caption — "1. Outsourcing Framework Project" — literal text;
 *   • "Key Projects:" — literal text, once per position;
 *   • the role-overview placeholder — a plain `<<…A0. Role Overview>>`, which
 *     renders an EMPTY PARAGRAPH when the value is blank rather than no
 *     paragraph at all.
 *
 * So a project slot with no selected evidence still announced itself with a
 * caption and left a hole underneath, and a role with no selected overview still
 * cost a blank line. `templateSlotData` answered that by refilling every empty
 * slot from the bullet bank — which is why cutting C3's bullet budget from 14 to
 * 9 never shortened the document (CI · CV Template Output Format §4). Worse than
 * neutral, in fact: a slot losing its single tailored bullet was refilled with up
 * to four bank bullets, so the LINE count went up as bullets came out.
 *
 * After this re-tag all three are loops over nought-or-one, fed by
 * `templateSlotData`. An empty project disappears whole — caption included — and
 * the surviving projects renumber, because the caption is now data rather than
 * text baked into the file.
 *
 *   npx tsx scripts/retag-cv-template-space.ts [--dry-run]
 */
import fs from 'node:fs';
import PizZip from 'pizzip';
import { TEMPLATE_PATH } from '../lib/docx/template';
import { CV_SLOTS, isRoleOverviewSlot } from '../lib/cv-slots';

const EN_GB = '<w:rPr><w:lang w:val="en-GB"/></w:rPr>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (t: string) => esc('<<' + t + '>>');

/** A paragraph holding nothing but a loop marker — docxtemplater's `paragraphLoop`
 *  deletes these and repeats what sits between them. Same construction as the
 *  first re-tag; kept identical on purpose so the two produce one shape. */
const marker = (t: string) => `<w:p><w:r>${EN_GB}<w:t xml:space="preserve">${tag(t)}</w:t></w:r></w:p>`;

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
  let xml = zip.file('word/document.xml')!.asText();
  const done: string[] = [];

  if (!xml.includes(esc('<<#'))) {
    throw new Error(
      'This template carries no loop tags — it is the ORIGINAL, not the retagged one. ' +
        'Run scripts/retag-cv-template.ts first; this script composes onto its output.'
    );
  }
  if (xml.includes(esc('<<#Key Projects'))) {
    throw new Error(
      'This template already carries the space tags — it has been retagged by this script. ' +
        'Re-running would double-apply. Restore it first: git checkout -- "Group CVs/CV_Template.docx"'
    );
  }

  /** The whole `<w:p>…</w:p>` containing the character at `i`. */
  function paragraphBounds(i: number): { start: number; end: number } {
    const start = Math.max(xml.lastIndexOf('<w:p ', i), xml.lastIndexOf('<w:p>', i));
    const end = xml.indexOf('</w:p>', i) + '</w:p>'.length;
    if (start === -1 || end < start) throw new Error(`Could not bound the paragraph at offset ${i}`);
    return { start, end };
  }

  /** Wrap the paragraph containing `needle` in `<<#name>>` … `<</name>>`, and
   *  optionally swap the text it carries for the loop item `<<.>>`. Fails loudly
   *  when the needle is absent or ambiguous — a silently skipped rewrite is how a
   *  template drifts out from under its code. */
  function wrapParagraph(needle: string, name: string, opts: { dynamicText?: boolean } = {}, from = 0): number {
    const i = xml.indexOf(needle, from);
    if (i === -1) throw new Error(`Template no longer contains: ${needle.slice(0, 160)}`);
    const { start, end } = paragraphBounds(i);
    const body = opts.dynamicText ? xml.slice(start, end).replace(needle, `<w:t xml:space="preserve">${tag('.')}</w:t>`) : xml.slice(start, end);
    const replacement = marker(`#${name}`) + body + marker(`/${name}`);
    xml = xml.slice(0, start) + replacement + xml.slice(end);
    done.push(name);
    return start + replacement.length;
  }

  // ── 1 · role overviews: a nought-or-one loop, not a blank paragraph ──────────
  // `<<A0. Role Overview>>` with an empty value rendered an empty `<w:p>` — a
  // blank line where a role's description used to be. As a loop it disappears.
  for (const slot of CV_SLOTS.filter(isRoleOverviewSlot)) {
    wrapParagraph(`<w:t>${tag(slot)}</w:t>`, slot, { dynamicText: true });
  }

  // ── 2 · project captions: data, so they can renumber ────────────────────────
  // The caption the first re-tag left is exactly the slot's own digit and name —
  // "A1. Outsourcing Framework Project" prints as "1. Outsourcing Framework
  // Project" — because item 4 of that re-tag restarted the numbering under each
  // position, which is what made the digits agree with the codes again. So the
  // literal to find is derivable from `CV_SLOTS` and needs no separate table.
  for (const slot of CV_SLOTS.filter((s) => !isRoleOverviewSlot(s))) {
    const caption = slot.replace(/^Professional Experience - [A-D]([0-9])\.\s*/, (_m, n: string) => `${n}. `);
    wrapParagraph(`<w:t>${esc(caption)}</w:t>`, `${slot} Caption`, { dynamicText: true });
  }

  // ── 3 · "Key Projects:" — one per position, conditional on having any ───────
  // Four identical literals, so they are taken in DOCUMENT ORDER and matched to
  // A/B/C/D, which is the order the positions appear in. Asserted, not assumed:
  // a template that stops carrying exactly four fails here rather than mis-keying
  // the fourth one onto position C.
  {
    const literal = '<w:t>Key Projects:</w:t>';
    const count = xml.split(literal).length - 1;
    if (count !== 4) throw new Error(`Expected four "Key Projects:" paragraphs, found ${count}`);
    let cursor = 0;
    for (const letter of ['A', 'B', 'C', 'D']) {
      cursor = wrapParagraph(literal, `Position ${letter} Key Projects`, {}, cursor);
    }
  }

  // ── 4 · Languages on one line ───────────────────────────────────────────────
  // `Process/C7…` §C has always called this "a small separate section at the
  // bottom", and it was four bulleted paragraphs — one per language — for four
  // facts of three words each. On three of the five measured leads those four
  // lines were the ENTIRE overflow onto page 3: everything else fitted.
  //
  // They now print inline, separated by ` · `, exactly as the Skills entries
  // under a category do. That is the same treatment for the same shape of data,
  // and it is three lines back on every CV at no cost to content.
  //
  // Not a return of the defect the first re-tag removed. That was one paragraph
  // holding several lines joined by soft breaks behind a literal "•  " prefix,
  // so Word bulleted the first line only. This is one paragraph holding one
  // line, and no bullet is claimed.
  {
    const start = xml.indexOf(tag('#Languages'));
    const end = xml.indexOf(tag('/Languages'));
    if (start === -1 || end === -1) throw new Error('No <<#Languages>> loop found — has the template changed shape?');
    const from = paragraphBounds(start).start;
    const to = paragraphBounds(end).end;
    xml =
      xml.slice(0, from) +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="60"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>' +
      `<w:r>${EN_GB}<w:t xml:space="preserve">${tag('Languages')}</w:t></w:r></w:p>` +
      xml.slice(to);
    done.push('Languages → one inline paragraph');
  }

  for (const line of done) console.log(`  + ${line}`);
  if (dryRun) {
    console.log(`\n--dry-run: ${done.length} paragraphs wrapped, template not written.`);
    return;
  }
  zip.file('word/document.xml', xml);
  fs.writeFileSync(TEMPLATE_PATH, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer);
  console.log(`\nWrote ${TEMPLATE_PATH} — ${done.length} paragraphs wrapped.`);
}

main();
