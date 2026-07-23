/**
 * Deterministic capture-time enrichment (A1 · Section B): URL cleanup and ATS
 * detection. Pure functions, no model call — run synchronously in createLead().
 * Also the mock fixture for the A1 AI extraction pass (Section C), which stays
 * conservative and never invents a company/city the way a live LLM might guess.
 */

// Section B.1 — strip by parameter KEY (case-insensitive), not literal string
// match: tracker values vary per capture (e.g. igbTracker's number), so this has
// to match keys regardless of value. Job/requisition IDs are not on this list on
// purpose — they must survive so the link still loads the posting.
const TRACKER_PARAM_DENYLIST = new Set(
  [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'source',
    'sourceType',
    'sourcetype',
    'Codes',
    'feedId',
    'igbTracker',
    'trk',
    'trackingId',
    'li_fat_id',
    'refId',
    'midToken',
    'liCampaign',
  ].map((k) => k.toLowerCase())
);

/** `sourceUrl` with known tracker query params stripped → the link used to apply. */
export function cleanJobPostLink(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return sourceUrl; // not a parseable absolute URL — leave it untouched
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKER_PARAM_DENYLIST.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString().replace(/\?$/, '');
}

// Section B.2 — ATS domain table. Extendable in place: add a row rather than
// opening a CI item every time a new ATS domain shows up.
const ATS_DOMAIN_TABLE: Array<{ patterns: string[]; name: string }> = [
  { patterns: ['myworkdayjobs.com', 'myworkday.com'], name: 'Workday' },
  { patterns: ['greenhouse.io', 'boards.greenhouse.io'], name: 'Greenhouse' },
  { patterns: ['lever.co', 'jobs.lever.co'], name: 'Lever' },
  { patterns: ['smartrecruiters.com'], name: 'SmartRecruiters' },
  { patterns: ['icims.com'], name: 'iCIMS' },
  { patterns: ['successfactors.com', 'career.sap.com'], name: 'SAP SuccessFactors' },
  { patterns: ['taleo.net'], name: 'Taleo' },
  { patterns: ['personio.de', 'personio.com'], name: 'Personio' },
  { patterns: ['bamboohr.com'], name: 'BambooHR' },
  { patterns: ['avature.net'], name: 'Avature' },
  { patterns: ['cornerstoneondemand.com', 'csod.com'], name: 'Cornerstone' },
  { patterns: ['oraclecloud.com'], name: 'Oracle Fusion/Cloud HCM' },
  { patterns: ['onlyfy.jobs'], name: 'Onlyfy (formerly softgarden)' },
];

/** Match `jobPostLink`'s hostname against known ATS domains. Null = no hit (B4 still runs its own fallback). */
export function detectAtsSystem(jobPostLink?: string | null): string | null {
  if (!jobPostLink) return null;
  let hostname: string;
  try {
    hostname = new URL(jobPostLink).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const { patterns, name } of ATS_DOMAIN_TABLE) {
    if (patterns.some((p) => hostname === p || hostname.endsWith(`.${p}`))) return name;
  }
  return null;
}

// Some off-site links aren't the ATS directly — they're routed through a
// recruiting AGENCY's own click-tracking redirect first (a hiring-company
// mechanism, distinct from LinkedIn's own safety/go wrapper). Unwrapping these
// means candidateLinks still reaches the real ATS, and it surfaces which
// companies outsource hiring to a third-party agency — a signal in itself, not
// just plumbing. Extendable in place, same pattern as the ATS table above.
const AGENCY_REDIRECTORS: Array<{ hostnames: string[]; name: string; unwrap: (url: URL) => string | null }> = [
  {
    hostnames: ['iventajobdata.eu'],
    name: 'Iventa',
    // Confirmed live 2026-07-23 against the AWS/Vienna lead
    // (08bec87c-c797-4804-9f24-081c00ac4395): LinkedIn -> iventajobdata.eu ->
    // aws.onlyfy.jobs. The last path segment is a single type-marker byte ('J')
    // followed by base64-encoded JSON: {"oldlink": "<real destination>", ...}.
    unwrap: (url) => {
      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (!last || !last.startsWith('J')) return null;
      try {
        const decoded = JSON.parse(Buffer.from(last.slice(1), 'base64').toString('utf8'));
        return typeof decoded?.oldlink === 'string' ? decoded.oldlink : null;
      } catch {
        return null;
      }
    },
  },
];

function unwrapAgencyRedirect(link: string): { url: string; agency: string } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  for (const r of AGENCY_REDIRECTORS) {
    if (r.hostnames.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      const target = r.unwrap(url);
      if (target) return { url: target, agency: r.name };
    }
  }
  return null;
}

// Section B.3 — LinkedIn captures never resolve sourceUrl to a known ATS domain
// (location.href is always linkedin.com); the real apply destination only shows
// up as an off-site link elsewhere on the page. The bookmarklet collects those as
// candidateLinks; this picks the first one that hits the B.2 table (after
// unwrapping a known agency redirector, if any).
export type CandidateMatch = { jobPostLink: string; atsSystem: string; viaAgency?: string };

export function pickCandidateJobPostLink(candidateLinks?: string[] | null): CandidateMatch | null {
  if (!candidateLinks) return null;
  for (const rawLink of candidateLinks) {
    const unwrapped = unwrapAgencyRedirect(rawLink);
    const link = unwrapped?.url ?? rawLink;
    const atsSystem = detectAtsSystem(link);
    if (!atsSystem) continue;
    const jobPostLink = cleanJobPostLink(link);
    if (!jobPostLink) continue;
    return { jobPostLink, atsSystem, viaAgency: unwrapped?.agency };
  }
  return null;
}

export type CaptureExtraction = {
  company: string | null;
  city: string | null;
  remote: 'on-site' | 'hybrid' | 'remote' | 'unspecified';
  formatSignals: string | null;
};

// Mock fixture for the A1 runStructured call (Section C). Real JD text is too
// inconsistent (LinkedIn/careers-page/ATS-hosted DOMs all differ) for a script to
// reliably name the company — the live LLM does that; this fixture stays honest
// about that limit and leaves company null rather than guess.
export function mockCaptureExtraction(markdown: string): CaptureExtraction {
  const text = markdown ?? '';
  const lines = text.split('\n').slice(0, 6);

  // LinkedIn-style capture header: "City, Region, Country · Posted X ago · N applicants"
  let city: string | null = null;
  for (const line of lines) {
    const m = line.match(/^([A-Za-zÀ-ÖØ-öø-ÿ .'-]{2,40}?),\s*[^·\n]+·/);
    if (m) {
      city = m[1].trim();
      break;
    }
  }

  const t = text.toLowerCase();
  let remote: CaptureExtraction['remote'] = 'unspecified';
  if (/\bhybrid\b/.test(t)) remote = 'hybrid';
  else if (/\b(fully remote|100%\s*remote|remote[- ]first|remote position|work from home)\b/.test(t)) remote = 'remote';
  else if (/\bremote\b/.test(t)) remote = 'remote';
  else if (/\bon[- ]site\b|\bin[- ]office\b/.test(t)) remote = 'on-site';

  const signalPatterns = [
    /no need for a (?:personal|cover) letter[^.\n]*/i,
    /(?:please\s+)?(?:include|attach|send)[^.\n]*cover letter[^.\n]*/i,
    /\b\d+(?:[-–]\d+)?\s*(?:pages?|words?)\b[^.\n]{0,40}/i,
    /\b(?:cv|resume)\b[^.\n]{0,20}\.(?:pdf|docx?|doc)\b/i,
    /\b(?:photo|headshot|passport photo)\b[^.\n]{0,40}/i,
    /recruiter\w*\s+[A-ZÄÖÜ][\wà-ÿ]+/i,
    /apply in [a-z]+\b[^.\n]*/i,
  ];
  const signals: string[] = [];
  for (const re of signalPatterns) {
    const m = text.match(re);
    if (m) signals.push(m[0].trim());
  }

  return { company: null, city, remote, formatSignals: signals.length ? signals.join(' | ') : null };
}
