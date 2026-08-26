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

/** The part the template's headshot relationship points at. */
const HEADSHOT_PART = 'word/media/cv-headshot.jpeg';

export const HEADSHOT_ASSET_PATH = path.join(process.cwd(), 'Group CVs', 'assets', 'headshot.jpeg');

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
  const doc = zip.file('word/document.xml');
  if (!doc) return [];
  if (!zip.file(HEADSHOT_PART)) return [];
  // Not referenced any more ⇒ this is a no-headshot CV. Leave it to be dropped.
  if (!/cv-headshot|rId106/.test(doc.asText()) && !referencesHeadshot(zip)) return [];
  if (!headshotAvailable()) return ['headshot: no asset at Group CVs/assets/headshot.jpeg — placeholder shipped'];
  zip.file(HEADSHOT_PART, fs.readFileSync(HEADSHOT_ASSET_PATH), { binary: true });
  return ['headshot: owner asset swapped in over the template placeholder'];
}

/** Does the rendered document still point at the headshot relationship? */
function referencesHeadshot(zip: PizZip): boolean {
  const rels = zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
  const id = rels.match(/<Relationship[^>]*Target="media\/cv-headshot\.jpeg"[^>]*Id="(rId\d+)"|<Relationship[^>]*Id="(rId\d+)"[^>]*Target="media\/cv-headshot\.jpeg"/);
  const rId = id?.[1] ?? id?.[2];
  if (!rId) return false;
  const doc = zip.file('word/document.xml')?.asText() ?? '';
  return new RegExp(`r:embed="${rId}"`).test(doc);
}
