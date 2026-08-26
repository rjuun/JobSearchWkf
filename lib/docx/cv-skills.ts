/**
 * Reading the CV's Skills section back out of a rendered document.
 *
 * The merged, categorised Skills section exists ONLY in the .docx — `cv_bullet_skills`
 * holds C4's tags from before C5 merges them, and C5's step report stores category
 * names and counts but not the items. So anything that wants to know what a CV
 * actually printed has to parse the document, and two things do:
 * `scripts/verify-lead-run.ts` (to check it against C5's report) and
 * `scripts/render-cv-from-stored.ts` (to feed a free re-render).
 *
 * They shared nothing, and when the section's layout changed the checker read zero
 * entries while the renderer read them fine. One parser now, so the next layout
 * change breaks in one place and is fixed once.
 *
 * TWO LAYOUTS, BOTH READ
 *   • current  — a category on its own line, its skills inline beneath it:
 *       Core Capabilities
 *       Strategic Execution · Cross-Functional Transformation
 *   • pre-2026-08-27 — category and skills on one line:
 *       Core Capabilities: Strategic Execution · Cross-Functional Transformation
 *
 * The old shape is still read because twenty already-generated CVs on disk carry
 * it, and a checker that cannot read last week's output is a checker nobody runs.
 */

export type SkillGroup = { category: string; items: string[] };

const splitItems = (s: string): string[] => s.split('·').map((x) => x.trim()).filter(Boolean);

/**
 * `lines` is the Skills section only — see `skillsBlock` for cutting it out of a
 * whole-document text. Blank lines are ignored; everything else is taken to be
 * either a category or the items belonging to the category above it.
 */
export function parseSkillGroups(lines: string[]): SkillGroup[] {
  const body = lines.map((l) => l.trim()).filter(Boolean);
  const groups: SkillGroup[] = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    // `": "` alone decides the old shape — NOT the presence of a `·`. A category
    // holding a single skill has no separator to show ("Additional Skills:
    // Cross-Functional Programme Leadership"), and a `·` test drops it silently.
    const colon = line.indexOf(': ');
    if (colon > 0) {
      groups.push({ category: line.slice(0, colon), items: splitItems(line.slice(colon + 2)) });
    } else if (body[i + 1] !== undefined) {
      groups.push({ category: line, items: splitItems(body[++i]) });
    }
  }
  return groups;
}

/** Every printed skill, in order — what the CV shows, flattened. */
export function parseSkillItems(lines: string[]): string[] {
  return parseSkillGroups(lines).flatMap((g) => g.items);
}

/**
 * A banner line, with whatever leads it stripped off.
 *
 * Each section name now has a small icon in front of it, and a text extractor
 * renders that as a placeholder — `pandoc -t plain` writes "[] SKILLS". Matching
 * the banner exactly stopped working the moment the icons went in, which is the
 * second time this section's read-back has been broken by a layout change it did
 * not know about. So the comparison is now on what the line ENDS with.
 */
const banner = (line: string) => line.replace(/^[\s[\]()·•*_-]+/, '').trim();

/**
 * The Skills section's lines, cut out of a full plain-text rendering of the CV by
 * its two banner headings. Returns null when the section is not found, so callers
 * can report "could not read" rather than "read nothing" — the distinction that
 * turns a parse failure into a parse failure instead of a phantom mismatch
 * against C5.
 */
export function skillsBlock(lines: string[]): string[] | null {
  const names = lines.map(banner);
  const start = names.indexOf('SKILLS');
  if (start === -1) return null;
  const end = names.indexOf('PROFESSIONAL EXPERIENCE', start + 1);
  if (end === -1) return null;
  return lines.slice(start + 1, end);
}
