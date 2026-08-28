/**
 * Rename the "Key Projects:" heading in `Group CVs/CV_Template.docx`.
 *
 * The owner, 2026-08-28: make it **"Key Project(s):"** — a position with one
 * project was printing a plural heading over a single item.
 *
 * WHY A SCRIPT FOR A TEXT SWAP
 * Two reasons, and the second is the one that bites. The template is a tracked
 * binary, so a hand edit lands in git as an opaque blob nobody can review. And
 * editing it in Word RENUMBERS EVERY MEDIA PART on save — which is exactly how
 * the headshot swap broke: `cv-headshot.jpeg` became `image1.jpeg`, the lookup
 * missed, and every CV shipped a grey placeholder in silence. Touching this file
 * anywhere but through a script re-opens that.
 *
 * The heading is template text, not data. `lib/pipeline/tailoring.ts` sets
 * `data['Position <L> Key Projects']` to a one-element array purely as a
 * conditional — the loop prints the paragraph, or does not — so the words that
 * reach the page come from here.
 *
 *   npx tsx scripts/set-key-projects-caption.ts [--dry-run]
 */
import fs from 'node:fs';
import PizZip from 'pizzip';
import { TEMPLATE_PATH } from '../lib/docx/template';
import { KEY_PROJECTS_CAPTION } from '../lib/cv-slots';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Every caption this heading has been through, so the script can find it
 *  whichever one the template currently carries and is safe to re-run. */
const KNOWN = ['Key Projects:', 'Key Project(s):'];

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
  let xml = zip.file('word/document.xml')!.asText();

  const want = `<w:t>${esc(KEY_PROJECTS_CAPTION)}</w:t>`;
  const already = xml.split(want).length - 1;
  if (already === 4) {
    console.log(`Already reads "${KEY_PROJECTS_CAPTION}" in all four positions — nothing to do.`);
    return;
  }

  const from = KNOWN.map((c) => `<w:t>${esc(c)}</w:t>`).find((needle) => xml.split(needle).length - 1 === 4);
  if (!from) {
    // One per position, and the count is asserted rather than assumed: a template
    // that no longer carries exactly four has changed shape, and guessing which
    // three to rewrite would leave one position reading differently from the rest.
    const found = KNOWN.map((c) => `${c} ×${xml.split(`<w:t>${esc(c)}</w:t>`).length - 1}`).join(', ');
    throw new Error(`Expected four identical caption paragraphs; found ${found}. The template has changed shape.`);
  }

  xml = xml.split(from).join(want);
  console.log(`  ${from.replace(/<[^>]*>/g, '')} → ${KEY_PROJECTS_CAPTION}  (×4)`);

  if (dryRun) {
    console.log('\n--dry-run: template not written.');
    return;
  }
  zip.file('word/document.xml', xml);
  fs.writeFileSync(TEMPLATE_PATH, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer);
  console.log(`\nWrote ${TEMPLATE_PATH}`);
}

main();
