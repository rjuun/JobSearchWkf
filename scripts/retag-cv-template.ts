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
import path from 'node:path';
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

/**
 * The images the template carries, lifted from the owner's own CV, in
 * `Group CVs/assets/`.
 *
 * The six icons are the answer to what item 2 was originally about: his CV puts a
 * small pictograph in front of each section banner, and they are IMAGES, not
 * characters. That is why "the unicodes are missing" had no unicode behind it and
 * why no font hypothesis fitted — nothing was missing from a font, the pictures
 * had simply never been in this template.
 *
 * `headshot` ships as a NEUTRAL PLACEHOLDER of the same dimensions. The real
 * photograph is gitignored and swapped in at render time
 * (`lib/docx/render-assets.ts`), because this repository has a GitHub remote and a
 * photograph of a person is not template data.
 */
const ASSETS_DIR = path.join(process.cwd(), 'Group CVs', 'assets');
const IMAGE_PARTS: { part: string; file: string; rId: string }[] = [
  { part: 'media/cv-icon-profile.png', file: 'icon-profile.png', rId: 'rId100' },
  { part: 'media/cv-icon-skills.png', file: 'icon-skills.png', rId: 'rId101' },
  { part: 'media/cv-icon-experience.png', file: 'icon-experience.png', rId: 'rId102' },
  { part: 'media/cv-icon-education.png', file: 'icon-education.png', rId: 'rId103' },
  { part: 'media/cv-icon-executive-education.png', file: 'icon-executive-education.png', rId: 'rId104' },
  { part: 'media/cv-icon-languages.png', file: 'icon-languages.png', rId: 'rId105' },
  { part: 'media/cv-headshot.jpeg', file: 'headshot.placeholder.jpeg', rId: 'rId106' },
];
const HEADSHOT_RID = 'rId106';

/** Which icon leads which banner. */
const SECTION_ICONS: Record<string, string> = {
  PROFILE: 'rId100',
  SKILLS: 'rId101',
  'PROFESSIONAL EXPERIENCE': 'rId102',
  EDUCATION: 'rId103',
  'EXECUTIVE EDUCATION': 'rId104',
  LANGUAGES: 'rId105',
};

/** An 11.1pt inline icon, as legacy VML — the form the owner's own CV uses, and
 *  the one that sits on the text baseline inside a heading without disturbing it. */
const iconRun = (rId: string, n: number) =>
  `<w:r><w:pict><v:shape id="CvIcon${n}" o:spid="_x0000_i${1030 + n}" type="#_x0000_t75" ` +
  `style="width:11.1pt;height:11.1pt;visibility:visible;mso-wrap-style:square">` +
  `<v:imagedata r:id="${rId}" o:title=""/></v:shape></w:pict></w:r>`;

/**
 * The headshot: a floating image anchored to the name paragraph, squared off to
 * the right margin, with rounded corners. Geometry copied from the owner's own CV
 * so the two documents sit the photograph in the same place.
 */
const headshotDrawing = () =>
  `<w:r><w:rPr><w:noProof/><w:lang w:val="en-GB"/></w:rPr><w:drawing>` +
  `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  `<wp:simplePos x="0" y="0"/>` +
  `<wp:positionH relativeFrom="margin"><wp:posOffset>5320665</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="margin"><wp:posOffset>-333375</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="986155" cy="1234440"/><wp:effectExtent l="0" t="0" r="4445" b="3810"/>` +
  `<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="20389598" name="Headshot"/>` +
  `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
  `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Headshot"/>` +
  `<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${HEADSHOT_RID}" cstate="print"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="986155" cy="1234440"/></a:xfrm>` +
  `<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></pic:spPr>` +
  `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;

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

  // ── 0 · media parts, relationships and content types ────────────────────────
  {
    for (const { part, file } of IMAGE_PARTS) {
      const src = path.join(ASSETS_DIR, file);
      if (!fs.existsSync(src)) throw new Error(`Missing template asset: ${src}`);
      zip.file(`word/${part}`, fs.readFileSync(src), { binary: true });
    }
    const relsPath = 'word/_rels/document.xml.rels';
    let rels = zip.file(relsPath)!.asText();
    for (const { part, rId } of IMAGE_PARTS) {
      if (rels.includes(`Id="${rId}"`)) continue;
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${part}"/></Relationships>`
      );
    }
    zip.file(relsPath, rels);

    let ct = zip.file('[Content_Types].xml')!.asText();
    for (const [ext, type] of [['png', 'image/png'], ['jpeg', 'image/jpeg']]) {
      if (!ct.includes(`Extension="${ext}"`)) {
        ct = ct.replace('<Default', `<Default Extension="${ext}" ContentType="${type}"/><Default`);
      }
    }
    zip.file('[Content_Types].xml', ct);
    done.push(`added ${IMAGE_PARTS.length} image parts + relationships + png/jpeg content types`);
  }

  // ── 1 · Personal Information: the owner's own header, and a headshot he can
  //        have or not have ─────────────────────────────────────────────────────
  // Ported from `Reginaldo_Silva_Jr_CV - CEO Associate Chief of Staff - Enpulsion.docx`,
  // which is the layout he actually uses: name left and large, a grey positioning
  // line under it, the contact line under that, and the photograph squared off to
  // the right margin. The template had all three centred and no room for a photo.
  //
  // ONE template serves both variants. The drawing sits inside an inline
  // `<<#Headshot>>` … `<</Headshot>>` loop, so an empty array removes it — and
  // `dropUnreferencedImages` then removes the JPEG from the package itself, because
  // a CV that deliberately carries no photograph must not still have one in its zip.
  {
    const nameP = paragraphAround(`<w:t>${tag('Name')}</w:t>`);
    const header =
      // Name, with the headshot anchored to it.
      `<w:p><w:pPr><w:spacing w:after="40"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>` +
      `<w:r>${EN_GB}<w:t xml:space="preserve">${tag('#Headshot')}</w:t></w:r>` +
      headshotDrawing() +
      `<w:r>${EN_GB}<w:t xml:space="preserve">${tag('/Headshot')}</w:t></w:r>` +
      `<w:r><w:rPr><w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="36"/><w:szCs w:val="36"/><w:lang w:val="en-GB"/></w:rPr>` +
      `<w:t xml:space="preserve">${tag('Name')}</w:t></w:r></w:p>` +
      // Positioning line — this lead's own B5 classification.
      `<w:p><w:pPr><w:spacing w:after="160"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>` +
      `<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-GB"/></w:rPr>` +
      `<w:t xml:space="preserve">${tag('JD Group Primary')} | ${tag('JD Group Secondary')}</w:t></w:r></w:p>` +
      // Contact line. The email carries the Hyperlink CHARACTER STYLE but no
      // relationship: it looks like his (blue, underlined) without baking a
      // `mailto:` for one particular address into a template meant to outlive it.
      `<w:p><w:pPr><w:spacing w:after="280"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>` +
      `<w:r>${EN_GB}<w:t xml:space="preserve">${tag('Location')}${tag('Relocation')}   |   ${tag('Phone')}   |   </w:t></w:r>` +
      `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:lang w:val="en-GB"/></w:rPr><w:t xml:space="preserve">${tag('Email')}</w:t></w:r>` +
      `<w:r>${EN_GB}<w:t xml:space="preserve">   |   ${tag('Citizenship')}</w:t></w:r></w:p>`;

    // The three paragraphs the old header occupied: name, JD groups, contacts.
    const jdP = paragraphAround(`<w:t>${tag('JD Group Primary')}`);
    const contactP = paragraphAround(`<w:t>${tag('Location')} ${tag('Relocation')}`);
    const from = Math.min(nameP.start, jdP.start, contactP.start);
    const to = Math.max(nameP.end, jdP.end, contactP.end);
    xml = xml.slice(0, from) + header + xml.slice(to);
    done.push('Personal Information → left-aligned header with an optional headshot');
  }

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

  // ── 2a · the section icons the banners never had ────────────────────────────
  // Item 2, answered properly at last. The ◆ dividers came out above; these are
  // what the owner's own CV actually puts in front of a section name, and they
  // cost no vertical space because they sit on the heading's own line.
  {
    let n = 0;
    for (const [heading, rId] of Object.entries(SECTION_ICONS)) {
      const textEl = `<w:t>${esc(heading)}</w:t>`;
      const p = paragraphAround(textEl);
      const runStart = p.xml.lastIndexOf('<w:r>', p.xml.indexOf(textEl));
      if (runStart === -1) throw new Error(`Could not find the run carrying the ${heading} banner`);
      // Icon first, then a space in front of the banner text, exactly as his does.
      const rebuilt =
        p.xml.slice(0, runStart) +
        iconRun(rId, ++n) +
        p.xml.slice(runStart).replace(textEl, `<w:t xml:space="preserve"> ${esc(heading)}</w:t>`);
      xml = xml.slice(0, p.start) + rebuilt + xml.slice(p.end);
      done.push(`icon on ${heading}`);
    }
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
        // A status qualifier under the title — "(coursework complete, thesis not
        // submitted)" — for the entries that carry one. Italic and grey: it
        // qualifies the qualification rather than competing with it. A loop over
        // nought-or-one, so entries without a qualifier lose the line entirely
        // rather than each leaving a blank one.
        marker('#Status') +
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="0"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>' +
        `<w:r><w:rPr><w:i/><w:iCs/><w:color w:val="595959"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="en-GB"/></w:rPr>` +
        `<w:t xml:space="preserve">${tag('.')}</w:t></w:r></w:p>` +
        marker('/Status') +
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
