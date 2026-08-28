/**
 * Give every delivered CI note a Done date on the dashboard.
 *
 * THE GAP
 * `+ Continuous Improvement Dashboard.md` derives its **Done** column by reading
 * each note's `simple-time-tracker` block and taking the latest `endTime` across
 * all entries — deliberately, so the date "can't drift from what the tracker
 * says". That works for a CI worked with the Obsidian timer running. It leaves a
 * dash for every CI delivered in a Claude Code session, where no timer ever ran:
 * twelve notes, including every CV-tailoring CI from the C-phase epic onward.
 *
 * WHAT THIS WRITES, AND WHAT IT REFUSES TO INVENT
 * One entry per note, named `Delivered`, with `startTime` **equal to** `endTime`
 * — the moment the note's `ci-status` last became `3 - Delivered`, taken from the
 * commit that made that change.
 *
 * The zero duration is the point. The tracker is described in the dashboard as
 * "the log of actual work sessions", and no session was observed for these; the
 * effort is already recorded in `ci-time-spent`, which this never touches.
 * Deriving plausible start/end boundaries from that figure would manufacture a
 * record of work that nobody logged, which is a different and worse thing than a
 * missing date. So this marks WHEN delivery happened and stays silent on how long
 * it took.
 *
 * Notes that already carry tracker entries are left alone, even where their last
 * entry predates delivery — those are the owner's own logged sessions, and
 * appending to them would edit his record of his own time rather than fill a hole
 * in it. `--report-stale` lists them instead.
 *
 *   npx tsx scripts/backfill-ci-delivered-dates.ts [--apply] [--report-stale]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CI_DIR = path.join(process.cwd(), 'Process', 'CI');
const DELIVERED = 'ci-status: 3 - Delivered';
const TRACKER = /```simple-time-tracker\s*\n([\s\S]*?)```/;

type Entry = { name?: string; startTime?: string; endTime?: string; subEntries?: Entry[] | null };

// `stdio` silences git's "path exists on disk but not in <sha>" chatter, which is
// expected: walking a note's history crosses commits from before it was added.
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });

/** The tracker block as every other note writes it, for a note that has none. */
const EMPTY_TRACKER = '\n---\n```simple-time-tracker\n{"entries":[]}\n```\n---\n';

/** Insert a tracker block after the frontmatter of a note missing one, matching
 *  the `--- / fence / ---` shape the rest of the folder uses. */
function withTrackerBlock(text: string): string | null {
  if (TRACKER.test(text)) return text;
  const fm = text.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) return null;
  return text.slice(0, fm[0].length) + EMPTY_TRACKER + text.slice(fm[0].length).replace(/^\s*---\n/, '');
}

/** The commit where this note LAST became `3 - Delivered` — its version carries
 *  the status and its parent's does not. A note that went Delivered, was reopened
 *  and delivered again reports the most recent of those, which is the one the
 *  dashboard should show. */
function deliveredAt(rel: string): string | null {
  const log = git('log', '--format=%H %aI', '--', rel).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, iso] = line.split(' ');
    let blob = '';
    try {
      blob = git('show', `${sha}:${rel}`);
    } catch {
      continue;
    }
    if (!blob.includes(DELIVERED)) continue;
    let parentBlob = '';
    try {
      const parent = git('rev-parse', `${sha}^`).trim().split('\n')[0];
      parentBlob = git('show', `${parent}:${rel}`);
    } catch {
      /* first commit — nothing before it, so this is where it arrived delivered */
    }
    if (!parentBlob.includes(DELIVERED)) return iso;
  }
  return null;
}

function endTimes(entries: Entry[] | null | undefined, out: string[]): void {
  for (const e of entries ?? []) {
    if (e.endTime) out.push(e.endTime);
    if (e.subEntries) endTimes(e.subEntries, out);
  }
}

function main() {
  const apply = process.argv.includes('--apply');
  const reportStale = process.argv.includes('--report-stale');
  const filled: string[] = [];
  const stale: string[] = [];
  const skipped: string[] = [];

  for (const file of fs.readdirSync(CI_DIR).sort()) {
    if (!file.endsWith('.md')) continue;
    const abs = path.join(CI_DIR, file);
    const rel = `Process/CI/${file}`;
    const text = fs.readFileSync(abs, 'utf8');
    if (!text.includes(DELIVERED)) continue;

    // A note with no tracker block at all gets an empty one first, so the Done
    // column has somewhere to read from. Same shape as every other note.
    const seeded = withTrackerBlock(text);
    if (!seeded) {
      skipped.push(`${file} — no tracker block and no frontmatter to put one after`);
      continue;
    }
    const block = seeded.match(TRACKER)!;
    let entries: Entry[] = [];
    try {
      entries = (JSON.parse(block[1]) as { entries?: Entry[] }).entries ?? [];
    } catch {
      skipped.push(`${file} — tracker block is not valid JSON, left untouched`);
      continue;
    }

    const iso = deliveredAt(rel);
    if (!iso) {
      skipped.push(`${file} — no commit found where it became delivered`);
      continue;
    }

    if (entries.length > 0) {
      const times: string[] = [];
      endTimes(entries, times);
      const latest = times.sort().pop();
      // Compared by DAY, not by timestamp. A session that ended at two and a
      // commit that landed at six the same afternoon is one working day, and
      // calling that stale would flag most of the folder for nothing.
      if (latest && latest.slice(0, 10) < iso.slice(0, 10)) {
        stale.push(`${file}\n      tracker ends ${latest.slice(0, 10)} · delivered ${iso.slice(0, 10)}`);
      }
      continue;
    }

    const entry: Entry = { name: 'Delivered', startTime: iso, endTime: iso };
    const replaced = seeded.replace(TRACKER, '```simple-time-tracker\n' + JSON.stringify({ entries: [entry] }) + '\n```');
    if (replaced === seeded) {
      skipped.push(`${file} — tracker block did not rewrite`);
      continue;
    }
    if (apply) fs.writeFileSync(abs, replaced);
    filled.push(`${iso.slice(0, 10)}  ${file}`);
  }

  console.log(`${apply ? 'WROTE' : 'DRY RUN —'} ${filled.length} delivery marker(s)\n`);
  for (const f of filled.sort()) console.log(`  ${f}`);
  if (skipped.length) {
    console.log(`\nSKIPPED ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  console.log(`\n${stale.length} note(s) already carry tracked sessions that END BEFORE delivery — left untouched.`);
  if (reportStale) for (const s of stale) console.log(`  ${s}`);
  else if (stale.length) console.log('  Re-run with --report-stale to list them.');
  if (!apply) console.log('\nNothing written. Re-run with --apply.');
}

main();
