/**
 * CI · CV Template Output Format — the one-off re-tag of `Group CVs/CV_Template.docx`.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A HAND EDIT
 * -----------------------------------------------
 * The template is a tracked binary, so a hand edit in Word lands in git as an
 * opaque blob — nobody reviewing the commit can see what changed. This script is
 * the diff: every paragraph it rewrites is named, and re-running it on an
 * already-retagged file fails loudly rather than double-applying.
 *
 * FIRST REVIEW — the six the CI opened on
 *   1  header line — `<<Location>> <<Relocation>>` loses its literal space, so a
 *      suppressed relocation leaves no orphan gap before the pipe. Whether the
 *      clause prints at all is `lib/pipeline/tailoring.ts`'s decision.
 *   2  the ◆ section dividers come out — see the block below for why this item
 *      inverted between the note and the page.
 *   3  Skills — one flat `<<Skills>>` paragraph becomes a loop emitting a bold
 *      category paragraph plus a plain inline-`·` paragraph per group.
 *   4  project numbering — the literal "4." / "5." / "6." / "7." captions under
 *      positions B/C/D restart at 1. These were always static text; no code
 *      change could have reached them.
 *   5  every bullet gets a bullet — each `<<Professional Experience - X#. …>>`
 *      placeholder becomes a paragraph LOOP, so one paragraph (and therefore one
 *      `numPr` bullet) is emitted per line, instead of one paragraph carrying
 *      every line as a soft break. Languages had the same defect, same treatment.
 *   6  Education / Executive Education — a per-entry paragraph with a RIGHT TAB
 *      STOP, so the date sits on the entry's own line instead of beneath it.
 *
 * SECOND REVIEW — from the owner's markup of the first re-render, 2026-08-27
 *   • the headshot line becomes conditional on C1's decision instead of fixed text
 *   • the ◆ dividers go, to buy back space
 *   • Education / Executive Education notes stop printing (in `tailoring.ts`)
 *   • one date treatment everywhere: grey, and abbreviated by `fmtCvDate`
 *   • one heading treatment everywhere: black bold, `HEADING_RPR`
 *
 *   npx tsx scripts/retag-cv-template.ts [--dry-run]
 */
import fs from 'node:fs';
import PizZip from 'pizzip';
import { TEMPLATE_PATH } from '../lib/docx/template';

const EN_GB = '<w:rPr><w:lang w:val="en-GB"/></w:rPr>';

/**
 * One treatment for every first-level heading — Skills category, position header,
 * Education / Executive Education entry. The owner's second review: *"Colours,
 * Bold Format and Sizes of all these 1st level Headings (Skills Groups, Positions,
 * Educations) should be the same (Black Bold preferred)."*
 *
 * They were three different things: position headers blue bold 11pt, Skills
 * categories black bold at body size, Education entries plain black. Black bold
 * 11pt is now the single answer, and it lives here so the next change is one edit
 * rather than three. The ALL-CAPS section banners (PROFILE, SKILLS, …) are a level
 * above these and keep their blue.
 */
const HEADING_RPR = '<w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/>';

/**
 * One treatment for every date — *"The same format and colour should be used for
 * all dates. I prefer to adopt the grey colour."* Copied verbatim off the position
 * date runs the template already had, which is the grey he pointed at; Education
 * dates were inheriting body black. The abbreviated MMM YYYY half of that
 * instruction is `fmtCvDate` in `lib/pipeline/tailoring.ts`.
 */
const DATE_RPR = '<w:color w:val="808080" w:themeColor="background1" w:themeShade="80"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-GB"/>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (t: string) => esc('<<' + t + '>>');

/** A paragraph holding nothing but a loop marker. docxtemplater's `paragraphLoop`
 *  deletes these and repeats what sits between them — which is the whole point:
 *  the repeated thing is a real `<w:p>`, so Word applies its list formatting to
 *  every iteration rather than to the first line only. */
const marker = (t: string) => `<w:p><w:r>${EN_GB}<w:t xml:space="preserve">${tag(t)}</w:t></w:r></w:p>`;

/** The bulleted paragraph, carrying the template's own list formatting
 *  (`Listenabsatz` + numId 3 + the 567tw indent it already used). */
const bulletPara = (content: string, before = 40, after = 40) =>
  '<w:p><w:pPr><w:pStyle w:val="Listenabsatz"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
  `<w:spacing w:before="${before}" w:after="${after}"/><w:ind w:left="567"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>` +
  `<w:r>${EN_GB}<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;

/**
 * Where a date's right tab stop goes.
 *
 * Taken from the position headers, which already had one — because the owner asked
 * for the dates to match each other, and a column that agrees with the four
 * position headers is the only one that reads as a column. Falls back to the text
 * width from `<w:sectPr>` if that tab stop ever goes away.
 */
function dateTabPosition(xml: string): number {
  const fromHeader = Number(xml.match(/<w:tab w:val="right" w:pos="(\d+)"/)?.[1]);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const w = Number(xml.match(/<w:pgSz[^>]*w:w="(\d+)"/)?.[1]);
  const mar = xml.match(/<w:pgMar[^>]*/)?.[0] ?? '';
  const left = Number(mar.match(/w:left="(\d+)"/)?.[1]);
  const right = Number(mar.match(/w:right="(\d+)"/)?.[1]);
  if (!w || !Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error('Could not read a date tab stop, page size or margins from the template');
  }
  return w - left - right;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
  const original = zip.file('word/document.xml')!.asText();
  let xml = original;
  const done: string[] = [];

  if (xml.includes(esc('<<#'))) {
    throw new Error(
      'This template already carries loop tags — it has been retagged. Re-running would double-apply. ' +
        'Restore it first: git checkout -- "Group CVs/CV_Template.docx"'
    );
  }

  const tabPos = dateTabPosition(xml);

  /** Replace exactly one occurrence, and fail if it is not there — a silently
   *  skipped rewrite is how a template drifts out from under its code. */
  function once(needle: string, replacement: string, what: string) {
    const i = xml.indexOf(needle);
    if (i === -1) throw new Error(`Template no longer contains the ${what} it is being retagged from: ${needle.slice(0, 160)}`);
    if (xml.indexOf(needle, i + 1) !== -1) throw new Error(`${what} appears more than once — refusing to guess which`);
    xml = xml.slice(0, i) + replacement + xml.slice(i + needle.length);
    done.push(what);
  }

  /** The whole `<w:p>…</w:p>` that contains `needle`. */
  function paragraphAround(needle: string): { start: number; end: number; xml: string } {
    const i = xml.indexOf(needle);
    if (i === -1) throw new Error(`Not found in template: ${needle.slice(0, 120)}`);
    const start = Math.max(xml.lastIndexOf('<w:p ', i), xml.lastIndexOf('<w:p>', i));
    const end = xml.indexOf('</w:p>', i) + '</w:p>'.length;
    if (start === -1 || end < start) throw new Error(`Could not bound the paragraph around: ${needle.slice(0, 120)}`);
    return { start, end, xml: xml.slice(start, end) };
  }

  function replaceParagraph(needle: string, replacement: string, what: string) {
    const p = paragraphAround(needle);
    xml = xml.slice(0, p.start) + replacement + xml.slice(p.end);
    done.push(what);
  }

  /** Swap the run properties of the one run carrying `textEl`, leaving the rest of
   *  its paragraph — style, tabs, spacing, sibling runs — alone. */
  function setRunProps(textEl: string, rPr: string, what: string) {
    const p = paragraphAround(textEl);
    const runStart = p.xml.lastIndexOf('<w:r>', p.xml.indexOf(textEl));
    if (runStart === -1) throw new Error(`Could not find the run carrying ${textEl.slice(0, 80)}`);
    const runEnd = p.xml.indexOf('</w:r>', runStart) + '</w:r>'.length;
    const run = p.xml.slice(runStart, runEnd);
    const rebuilt = run.includes('<w:rPr>')
      ? run.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, `<w:rPr>${rPr}</w:rPr>`)
      : run.replace('<w:r>', `<w:r><w:rPr>${rPr}</w:rPr>`);
    xml = xml.slice(0, p.start) + p.xml.slice(0, runStart) + rebuilt + p.xml.slice(runEnd) + xml.slice(p.end);
    done.push(what);
  }

  // ── 1 · header line: drop the literal space between Location and Relocation ──
  // The relocation clause now arrives from the pipeline carrying its own leading
  // separator when it prints, and as '' when it does not — so the template must
  // not contribute a space that would outlive the suppression.
  once(`${tag('Location')} ${tag('Relocation')}`, `${tag('Location')}${tag('Relocation')}`, 'header Location/Relocation spacing');

  // ── 2 · the ◆ section dividers come OUT ─────────────────────────────────────
  // The owner's item 2 opened as "the unicodes are missing" — read from a marked-up
  // CV, and read as though the section banners had lost their glyphs. They never
  // had any: no committed version of this template put a glyph on a banner. What
  // it did have were three centred ◆ dividers above EDUCATION, EXECUTIVE EDUCATION
  // and LANGUAGES, and seeing them rendered, the instruction became the opposite of
  // what the note recorded: *"Eliminate these unicode symbols to save space."*
  // Three paragraphs, three lines back.
  {
    let removed = 0;
    for (;;) {
      const i = xml.indexOf('<w:t>◆</w:t>');
      if (i === -1) break;
      const p = paragraphAround('<w:t>◆</w:t>');
      xml = xml.slice(0, p.start) + xml.slice(p.end);
      removed++;
      if (removed > 10) throw new Error('Refusing to strip more than ten ◆ paragraphs — the template is not the shape this expects');
    }
    if (removed === 0) throw new Error('No ◆ divider paragraphs found — has the template changed shape?');
    done.push(`removed ${removed} ◆ divider paragraph(s)`);
  }

  // ── 2b · the headshot line is C1's to decide, not the template's ────────────
  // It was fixed text and printed on every CV. C7 §5 says the sentence goes in
  // "if no headshot is included", and C1 decides that per lead — so the paragraph
  // is now a loop over nought-or-one strings, and disappears entirely rather than
  // leaving a blank line where it used to assert a D&I rationale that did not hold.
  replaceParagraph(
    `<w:t>${esc('Headshot not added in respect to D&I best practices.')}</w:t>`,
    marker('#Headshot Note') +
      '<w:p><w:pPr><w:spacing w:before="20"/><w:jc w:val="center"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>' +
      `<w:r><w:rPr><w:i/><w:iCs/><w:color w:val="808080"/><w:lang w:val="en-GB"/></w:rPr><w:t xml:space="preserve">${tag('.')}</w:t></w:r></w:p>` +
      marker('/Headshot Note'),
    'headshot note → conditional loop'
  );

  // ── 2c · one look for every first-level heading ─────────────────────────────
  // Position headers were blue; Skills categories and Education entries are built
  // with `HEADING_RPR` further down, so this is the only place a pre-existing run
  // has to be brought into line.
  for (const letter of ['A', 'B', 'C', 'D']) {
    setRunProps(`<w:t>${tag(`Position ${letter} Header`)}</w:t>`, HEADING_RPR, `Position ${letter} header → black bold`);
  }

  // ── 3 · Skills: a bold category paragraph + an inline `·` paragraph per group ─
  // `keepNext` on the category so a page break can never strand a heading from
  // the skills it heads.
  replaceParagraph(
    `<w:t>${tag('Skills')}</w:t>`,
    marker('#Skills') +
      `<w:p><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="0"/><w:rPr>${HEADING_RPR}</w:rPr></w:pPr>` +
      `<w:r><w:rPr>${HEADING_RPR}</w:rPr><w:t xml:space="preserve">${tag('Category')}</w:t></w:r></w:p>` +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="60"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>' +
      `<w:r>${EN_GB}<w:t xml:space="preserve">${tag('Items')}</w:t></w:r></w:p>` +
      marker('/Skills'),
    'Skills → bold-category / inline-items loop'
  );

  // ── 4 · project numbering restarts under each position ──────────────────────
  // Static caption text, always was. Position A already reads 1/2/3.
  const captions: [string, string][] = [
    ['4. Accounting Correction Layer Project', '1. Accounting Correction Layer Project'],
    ['5. Transfer Pricing', '2. Transfer Pricing'],
    ['6. BBSA Merger Project', '1. BBSA Merger Project'],
    ['7. Servicing Center Project', '1. Servicing Center Project'],
  ];
  for (const [from, to] of captions) {
    once(`<w:t>${esc(from)}</w:t>`, `<w:t>${esc(to)}</w:t>`, `project caption "${from}" → "${to}"`);
  }

  // ── 5 · every project bullet gets its own bulleted paragraph ────────────────
  const slotTags = [...original.matchAll(/&lt;&lt;(Professional Experience - [A-D][1-9]\.[^&]*)&gt;&gt;/g)].map((m) => m[1]);
  if (slotTags.length === 0) throw new Error('No project bullet placeholders found — has the template changed shape?');
  for (const slot of slotTags) {
    const p = paragraphAround(`<w:t>${tag(slot)}</w:t>`);
    const repeated = p.xml.replace(tag(slot), tag('.'));
    xml = xml.slice(0, p.start) + marker(`#${slot}`) + repeated + marker(`/${slot}`) + xml.slice(p.end);
    done.push(`bullet loop · ${slot}`);
  }

  // ── 6 · Education / Executive Education: date on the entry's own line ───────
  // A right tab stop at the text-column edge. A long institution name now wraps
  // the head onto a second line with the date still right-aligned on it — it can
  // no longer be pushed onto a line of its own.
  for (const section of ['Education', 'Executive Education']) {
    replaceParagraph(
      `<w:t>${tag(section)}</w:t>`,
      marker(`#${section}`) +
        `<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:val="right" w:pos="${tabPos}"/></w:tabs>` +
        '<w:spacing w:before="80" w:after="0"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>' +
        `<w:r><w:rPr>${HEADING_RPR}</w:rPr><w:t xml:space="preserve">${tag('Head')}</w:t></w:r>` +
        `<w:r>${EN_GB}<w:tab/></w:r>` +
        `<w:r><w:rPr>${DATE_RPR}</w:rPr><w:t xml:space="preserve">${tag('Dates')}</w:t></w:r></w:p>` +
        marker(`/${section}`),
      `${section} → per-entry loop, right tab stop at ${tabPos}tw`
    );
  }

  // ── 5 (cont.) · Languages: real bullets, replacing the literal "•  " prefix ──
  // That prefix in `lib/pipeline/tailoring.ts` was the workaround someone reached
  // for on hitting this same defect, fixed for one field only. The loop makes it
  // unnecessary, and the pipeline drops it in the same commit.
  replaceParagraph(
    `<w:t>${tag('Languages')}</w:t>`,
    marker('#Languages') + bulletPara(tag('.')) + marker('/Languages'),
    'Languages → bulleted loop'
  );

  for (const line of done) console.log(`  + ${line}`);
  if (dryRun) {
    console.log(`\n--dry-run: ${done.length} edits, template not written.`);
    return;
  }
  zip.file('word/document.xml', xml);
  fs.writeFileSync(TEMPLATE_PATH, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer);
  console.log(`\nWrote ${TEMPLATE_PATH} — ${done.length} edits.`);
}

main();
