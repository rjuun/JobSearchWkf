/**
 * Owner profile context loaded from the methodology's source notes (the `Profile/`
 * markdown). B3 (Misalignments) is meant to weigh the role against the candidate's
 * values, motives and preferences — not just the JD text — so we surface a concise
 * Values & Motives summary into that step's payload.
 *
 * Prototype scope: the notes are the seed owner's local files (gitignored). For a
 * multi-tenant build this moves to a per-owner DB field; see ROADMAP P6.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROFILE_DIR = path.join(process.cwd(), 'Profile');

// Notes that speak to fit/values/preferences, most-relevant first.
const VALUES_NOTES = [
  '12 - Values Motivs & Interest.md',
  '12 - What am I looking in a new Company.md',
  '13 - Likes and Dislikes.md',
];

const PER_NOTE_CHARS = 1400;
const TOTAL_CHARS = 3500;

/** Strip markdown chrome so the summary reads as plain prose for the prompt. */
function clean(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\s*/, '') // frontmatter
    .replace(/^#{1,6}\s*/gm, '') // headings
    .replace(/^\s*\[!\w+\][-+]?\s*/gm, '') // Obsidian callout markers
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // wikilinks → inner text
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A condensed Values & Motives summary for B3, or '' when no notes are present
 * (keyless/empty installs degrade gracefully to the previous JD-only behaviour).
 */
export function readValuesSummary(): string {
  const parts: string[] = [];
  for (const file of VALUES_NOTES) {
    try {
      const p = path.join(PROFILE_DIR, file);
      if (!fs.existsSync(p)) continue;
      const text = clean(fs.readFileSync(p, 'utf8')).slice(0, PER_NOTE_CHARS);
      if (text) parts.push(text);
    } catch {
      // ignore unreadable notes — this context is best-effort
    }
  }
  return parts.join('\n\n').slice(0, TOTAL_CHARS);
}
