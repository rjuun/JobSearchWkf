/**
 * Re-read a LinkedIn posting to find out whether it is still accepting
 * applications — CI · Lead Liveness Re-check and Not Pursued Reason Tags.
 *
 * Why this can exist at all: LinkedIn serves a logged-out "guest" fragment for
 * every public job at
 * `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>` — no auth,
 * 20–64 KB, and it carries the closed marker, the posted-time-ago string and the
 * title. Verified against three of the owner's own leads (2026-08-23): the
 * `closed-job__flavor--closed` node was present on both closed postings and
 * absent on the open one, which is the whole discriminator, with no heuristic.
 *
 * This is the SECOND `fetch()` in the codebase (`lib/llm/client.ts` has the
 * other). That is not an accident of scope: capture deliberately never fetches —
 * a JD is pushed in, pasted or POSTed to `/api/ingest` by an agent that already
 * rendered the page, because a script inside the posting's own document hits a
 * CSP wall (A1 §A.1/A.2, why the bookmarklet was retired). Re-reading one known
 * URL shape server-side inherits none of that; it is not a step toward
 * re-implementing capture, and it should not grow into one.
 *
 * Deliberately narrow:
 *   - LinkedIn only. Of 172 leads, 55 carry a LinkedIn `sourceUrl` and 6 carry a
 *     non-LinkedIn `jobPostLink` — on six DIFFERENT hosts. One bespoke parser
 *     per lead is not a trade worth making; those fall back to the manual answer.
 *   - `applicantCount` is NOT read. `num-applicants__figure` came back empty on
 *     the closed postings and absent on the open one, so saturation cannot be
 *     refreshed this way. Reporting it as refreshed would be a lie about data
 *     that never moved.
 *
 * Every failure is a `{ ok: false }` — never a throw and never a guess. An
 * unreadable posting must leave the stored answer alone: "we could not look" and
 * "it is closed" are different facts, and conflating them would retire a live
 * lead on a network blip.
 */

/** The `<jobId>` in a canonical posting URL, or null if this isn't one. */
export function linkedInJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  // /jobs/view/4407636740/ — the shape every captured lead uses. Also accepts
  // the ?currentJobId= form some search/collection URLs carry.
  const path = u.pathname.match(/\/jobs\/view\/(\d{6,})/);
  if (path) return path[1];
  const param = u.searchParams.get('currentJobId');
  return param && /^\d{6,}$/.test(param) ? param : null;
}

/**
 * "3 weeks ago" → 21. LinkedIn writes the posted date only as a relative
 * phrase, so this is an approximation by construction — which is fine, because
 * every consumer is a band (`freshnessBand`: 7 / 21 / 60 / 120 day edges), not
 * an exact date. Months are 30 days and years 365 on purpose: precision the
 * source doesn't have would be invented.
 *
 * "Reposted 2 weeks ago" counts from the repost, which is the honest reading —
 * that is when the posting became current again.
 */
export function parsePostedDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(just now|moments? ago)\b/.test(t)) return 0;
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case 'minute':
    case 'hour':
      return 0;
    case 'day':
      return n;
    case 'week':
      return n * 7;
    case 'month':
      return n * 30;
    case 'year':
      return n * 365;
    default:
      return null;
  }
}

/** First text node under an element carrying `className`, trimmed. */
function textOfClass(html: string, className: string): string | null {
  const re = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>\\s*([^<]{0,300})`, 'i');
  const m = html.match(re);
  const text = m?.[1]?.trim();
  return text ? text.replace(/\s+/g, ' ') : null;
}

export type PostingRead = {
  /** True only when the closed marker is present. Absent marker = still open. */
  closed: boolean;
  postedDays: number | null;
  /** For sanity-checking that the fetch returned the posting we asked for. */
  title: string | null;
};

/**
 * Parse the guest fragment. Split from the fetch so the interesting half is
 * testable without a network call.
 *
 * `closed` is deliberately "the marker is present", not "the marker is absent →
 * open". A fragment that failed to render, or an entirely different page, has no
 * marker either — which is why `parsePosting` returns null when it can't even
 * find a title, rather than reporting a page it didn't understand as open.
 */
export function parsePosting(html: string): PostingRead | null {
  const title = textOfClass(html, 'topcard__title');
  const closedMarker = textOfClass(html, 'closed-job__flavor--closed');
  // No title means this isn't a rendered job fragment — an auth wall, an error
  // page, or a shape change. Refusing to interpret it is the point.
  if (!title && !closedMarker) return null;
  return {
    closed: closedMarker != null,
    postedDays: parsePostedDays(textOfClass(html, 'posted-time-ago__text')),
    title,
  };
}

export type PostingLookup =
  | { ok: true; read: PostingRead }
  | { ok: false; reason: 'not-linkedin' | 'unreachable' | 'blocked' | 'unreadable'; detail: string };

const GUEST_ENDPOINT = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
// A real desktop UA. The guest fragment is public, but LinkedIn serves a
// different (or no) body to obviously-automated clients.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Fetch and parse one posting. Never throws.
 *
 * LinkedIn rate-limits and blocks datacenter ranges — 429, or its idiosyncratic
 * 999 — so `blocked` is called out separately from `unreachable`: the first
 * means "ask again later from somewhere else", the second means the network or
 * the URL is wrong. Both leave the stored answer untouched.
 */
export async function readLinkedInPosting(url: string | null | undefined, timeoutMs = 15_000): Promise<PostingLookup> {
  const jobId = linkedInJobId(url);
  if (!jobId) return { ok: false, reason: 'not-linkedin', detail: 'No LinkedIn job id in this lead’s URL.' };

  let res: Response;
  try {
    res = await fetch(`${GUEST_ENDPOINT}/${jobId}`, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, reason: 'unreachable', detail: e instanceof Error ? e.message : String(e) };
  }

  if (res.status === 429 || res.status === 999) {
    return { ok: false, reason: 'blocked', detail: `LinkedIn returned ${res.status} — rate-limited or blocked.` };
  }
  if (!res.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}.` };

  const read = parsePosting(await res.text());
  if (!read) {
    return { ok: false, reason: 'unreadable', detail: 'Fetched, but the response was not a job fragment.' };
  }
  return { ok: true, read };
}
