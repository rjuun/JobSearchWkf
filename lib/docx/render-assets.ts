/**
 * Per-owner image assets, swapped into the rendered package at the last moment.
 *
 * WHY THE PHOTOGRAPH IS NOT IN THE TEMPLATE
 * The template is a tracked binary in a repository with a GitHub remote, and the
 * `.gitignore` at the root of this project opens by saying personal data is never
 * committed. A photograph of a real person is personal data in a way that a job
 * title is not. So `Group CVs/CV_Template.docx` embeds a neutral placeholder of
 * the right dimensions, `Group CVs/assets/headshot.jpeg` is gitignored, and the
 * real bytes replace the placeholder here, after docxtemplater has run.
 *
 * It is also the better shape for where this is going: one owner's face is not a
 * property of a template that is meant to serve more than one owner.
 *
 * If the asset is absent the placeholder ships instead — visibly a placeholder,
 * which is the honest failure. A CV that silently dropped the photo would look
 * exactly like one C1 had decided against.
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';

/**
 * How the headshot is found in the package.
 *
 * NOT by filename. The re-tag script wrote `word/media/cv-headshot.jpeg`, and
 * then the template was opened and saved in Word — which renumbers every media
 * part on its way out. The file became `word/media/image1.jpeg`, this module's
 * lookup missed, and it returned early: no error, no warning, and every CV
 * rendered with the grey placeholder instead of the owner's photograph. Caught by
 * looking at a page, which is the only place it was visible.
 *
 * What survives a Word round trip is the drawing's own `name`, because it is
 * authored content rather than packaging. So the lookup goes the other way:
 * find the drawing called "Headshot", read the relationship it embeds, and
 * resolve that to whatever part the package currently calls it.
 */
const HEADSHOT_DRAWING_NAME = 'Headshot';

export const HEADSHOT_ASSET_PATH = path.join(process.cwd(), 'Group CVs', 'assets', 'headshot.jpeg');

/** The media part the headshot drawing currently points at, or null when the
 *  drawing is not in the document — which is what a no-headshot CV looks like. */
function headshotPart(zip: PizZip): string | null {
  const doc = zip.file('word/document.xml')?.asText();
  if (!doc) return null;
  // The `r:embed` inside the drawing whose docPr carries the name.
  const at = doc.indexOf(`name="${HEADSHOT_DRAWING_NAME}"`);
  if (at === -1) return null;
  const rId = doc.slice(at).match(/r:embed="(rId\d+)"/)?.[1];
  if (!rId) return null;
  const rels = zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
  const rel = rels.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*>`))?.[0];
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) return null;
  const part = `word/${target.replace(/^\.\//, '')}`;
  return zip.file(part) ? part : null;
}

/** Whether a real photograph is available to render with. */
export function headshotAvailable(): boolean {
  try {
    return fs.existsSync(HEADSHOT_ASSET_PATH) && fs.statSync(HEADSHOT_ASSET_PATH).size > 0;
  } catch {
    return false;
  }
}

/**
 * Replace the placeholder photograph with the owner's own, if there is one and if
 * the rendered document still references it. A CV C1 decided against a headshot
 * for has already had the drawing removed, and `dropUnreferencedImages` is about
 * to delete the part — swapping real bytes in first would be pointless and would
 * briefly put his face into a document that must not carry it.
 */
export function applyHeadshot(zip: PizZip): string[] {
  // No drawing ⇒ C1 decided against a headshot and the loop already removed it.
  // `dropUnreferencedImages` is about to delete the part; swapping real bytes in
  // first would be pointless and would briefly put his face into a document that
  // must not carry it.
  const part = headshotPart(zip);
  if (!part) return [];
  if (!headshotAvailable()) return [`headshot: no asset at ${HEADSHOT_ASSET_PATH} — the PLACEHOLDER shipped`];
  zip.file(part, fs.readFileSync(HEADSHOT_ASSET_PATH), { binary: true });
  return [`headshot: owner asset swapped into ${part}`];
}
