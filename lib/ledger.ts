/**
 * R6 · The Transition Ledger (board #4b). Month four of a slow search, reframed as
 * what it actually is — accumulation, not stagnation. No new capture: a pure timeline
 * projection composing three streams the app already writes —
 *   • graph_strength_snapshots — the meter climbing
 *   • activity_events — evidence kept, targets flagged, CVs made
 *   • story_versions — the through-line maturing
 * — into "here's what these months built." Deterministic; unit-tested.
 */

export type LedgerSnapshot = { score: number; at: Date };
export type LedgerActivity = { kind: string; at: Date };
export type LedgerStory = { at: Date };

export type LedgerMonth = {
  key: string; //     YYYY-MM
  label: string; //   "March 2026"
  endStrength: number | null;
  gained: number; //  strength climbed within the month
  evidenceKept: number;
  coachApproved: number;
  targetsFlagged: number;
  cvsGenerated: number;
  applied: number;
  storyVersions: number;
  headline: string;
};

export type LedgerTotals = {
  evidenceKept: number;
  coachApproved: number;
  targetsFlagged: number;
  cvsGenerated: number;
  applied: number;
  storyVersions: number;
};

export type Ledger = {
  months: LedgerMonth[]; //   newest first
  weeks: number; //           weeks elapsed since the first signal
  currentStrength: number | null;
  totalGain: number; //       first snapshot → last snapshot
  totals: LedgerTotals;
  summaryLine: string;
  empty: boolean; //          no signals at all
  substantive: boolean; //    enough accumulation to be worth showing (self-gate)
};

/** Below this many combined signals the ledger stays "still gathering" (R6 self-gate). */
export const LEDGER_MIN_EVENTS = 5;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Honest composition of what a period built — only the non-zero parts, no padding. */
function periodHeadline(m: Omit<LedgerMonth, 'headline'>): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(m.evidenceKept, 'piece of evidence kept', 'pieces of evidence kept');
  add(m.coachApproved, 'coached answer', 'coached answers');
  add(m.cvsGenerated, 'CV tailored', 'CVs tailored');
  add(m.targetsFlagged, 'target flagged', 'targets flagged');
  add(m.storyVersions, 'story version', 'story versions');
  add(m.applied, 'application sent', 'applications sent');
  const built = parts.length === 0 ? 'Quiet month' : parts.slice(0, 3).join(', ') + (parts.length > 3 ? `, +${parts.length - 3} more` : '');
  return m.gained > 0 ? `${built} — graph +${m.gained}` : built;
}

export function buildLedger(
  snapshots: LedgerSnapshot[],
  activity: LedgerActivity[],
  stories: LedgerStory[],
  now: Date
): Ledger {
  const emptyTotals: LedgerTotals = {
    evidenceKept: 0,
    coachApproved: 0,
    targetsFlagged: 0,
    cvsGenerated: 0,
    applied: 0,
    storyVersions: 0,
  };

  const allDates = [...snapshots.map((s) => s.at), ...activity.map((a) => a.at), ...stories.map((s) => s.at)];
  const eventCount = snapshots.length + activity.length + stories.length;
  if (allDates.length === 0) {
    return {
      months: [],
      weeks: 0,
      currentStrength: null,
      totalGain: 0,
      totals: emptyTotals,
      summaryLine: 'Your ledger fills in as you keep evidence, tailor CVs and grow your story.',
      empty: true,
      substantive: false,
    };
  }

  const snaps = [...snapshots].sort((a, b) => a.at.getTime() - b.at.getTime());
  const firstAt = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const weeks = Math.max(1, Math.ceil((now.getTime() - firstAt.getTime()) / WEEK_MS));

  // Every month that any stream touched.
  const keys = new Set<string>();
  const anchor = new Map<string, Date>();
  for (const d of allDates) {
    const k = monthKey(d);
    keys.add(k);
    if (!anchor.has(k)) anchor.set(k, d);
  }

  const kindIn = (k: string, kind: string) => activity.filter((a) => monthKey(a.at) === k && a.kind === kind).length;

  const months: LedgerMonth[] = [...keys]
    .sort((a, b) => (a < b ? 1 : -1)) // newest first
    .map((k) => {
      const snapsIn = snaps.filter((s) => monthKey(s.at) === k);
      const endStrength = snapsIn.length ? snapsIn[snapsIn.length - 1].score : null;
      // Climb attributable to the month = last-in-month minus the last snapshot before it.
      const before = snaps.filter((s) => s.at.getTime() < (snapsIn[0]?.at.getTime() ?? Infinity));
      const carryIn = before.length ? before[before.length - 1].score : snapsIn[0]?.score ?? 0;
      const gained = endStrength != null ? Math.max(0, endStrength - carryIn) : 0;
      const base = {
        key: k,
        label: monthLabel(anchor.get(k) as Date),
        endStrength,
        gained,
        evidenceKept: kindIn(k, 'evidence_kept'),
        coachApproved: kindIn(k, 'coach_approved'),
        targetsFlagged: kindIn(k, 'target_flagged'),
        cvsGenerated: kindIn(k, 'cv_generated'),
        applied: kindIn(k, 'applied'),
        storyVersions: stories.filter((s) => monthKey(s.at) === k).length,
      };
      return { ...base, headline: periodHeadline(base) };
    });

  const totals: LedgerTotals = {
    evidenceKept: activity.filter((a) => a.kind === 'evidence_kept').length,
    coachApproved: activity.filter((a) => a.kind === 'coach_approved').length,
    targetsFlagged: activity.filter((a) => a.kind === 'target_flagged').length,
    cvsGenerated: activity.filter((a) => a.kind === 'cv_generated').length,
    applied: activity.filter((a) => a.kind === 'applied').length,
    storyVersions: stories.length,
  };

  const currentStrength = snaps.length ? snaps[snaps.length - 1].score : null;
  const totalGain = snaps.length ? Math.max(0, snaps[snaps.length - 1].score - snaps[0].score) : 0;

  const built: string[] = [];
  if (totals.evidenceKept) built.push(`kept ${totals.evidenceKept} piece${totals.evidenceKept === 1 ? '' : 's'} of evidence`);
  if (totals.cvsGenerated) built.push(`tailored ${totals.cvsGenerated} CV${totals.cvsGenerated === 1 ? '' : 's'}`);
  if (totals.targetsFlagged) built.push(`opened ${totals.targetsFlagged} target${totals.targetsFlagged === 1 ? '' : 's'}`);
  const builtLine = built.length ? built.slice(0, 2).join(', ') : 'kept the search moving';
  const gainLine = totalGain > 0 ? `, and lifted your graph +${totalGain}` : '';
  const summaryLine = `In ${weeks} week${weeks === 1 ? '' : 's'}, you ${builtLine}${gainLine}.`;

  return { months, weeks, currentStrength, totalGain, totals, summaryLine, empty: false, substantive: eventCount >= LEDGER_MIN_EVENTS };
}
