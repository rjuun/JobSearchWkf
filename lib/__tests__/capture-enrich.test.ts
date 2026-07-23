import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { cleanJobPostLink, detectAtsSystem, mockCaptureExtraction, pickCandidateJobPostLink } from '../pipeline/capture-enrich';

// ── B.1 · URL cleanup ────────────────────────────────────────────────────────
// Real tracker fragments from Process/CI/Job Lead Capture Improvement.md §2 —
// these are the exact strings this has to survive, not synthetic approximations.
describe('cleanJobPostLink', () => {
  it('strips igbTracker + utm_source, keeps the job id', () => {
    expect(cleanJobPostLink('https://boards.greenhouse.io/acme/jobs/123?jobId=123&igbTracker=926613858&utm_source=linkedin')).toBe(
      'https://boards.greenhouse.io/acme/jobs/123?jobId=123'
    );
  });

  it('strips ?source=LinkedIn', () => {
    expect(cleanJobPostLink('https://example.com/careers/job?source=LinkedIn')).toBe('https://example.com/careers/job');
  });

  it('strips /?Codes=LinkedIn (case-insensitive key match)', () => {
    expect(cleanJobPostLink('https://example.com/jobs/55/?Codes=LinkedIn')).toBe('https://example.com/jobs/55/');
  });

  it('strips /?feedId=445533', () => {
    expect(cleanJobPostLink('https://example.com/postings?feedId=445533')).toBe('https://example.com/postings');
  });

  it('strips ?utm_source=linkedin', () => {
    expect(cleanJobPostLink('https://example.com/apply?utm_source=linkedin')).toBe('https://example.com/apply');
  });

  it('strips ?utm_source=linkedin.com&utm_medium=job_posting (value containing a domain does not confuse key-based matching)', () => {
    expect(cleanJobPostLink('https://example.com/apply?utm_source=linkedin.com&utm_medium=job_posting')).toBe(
      'https://example.com/apply'
    );
  });

  it('strips ?source=LinkedIn&sourceType=PREMIUM_POST_SITE, keeps req id, drops the trailing ?', () => {
    expect(cleanJobPostLink('https://example.com/job?req=REQ-99&source=LinkedIn&sourceType=PREMIUM_POST_SITE')).toBe(
      'https://example.com/job?req=REQ-99'
    );
  });

  it('strips &utm_source=linkedin appended after a real param', () => {
    expect(cleanJobPostLink('https://example.com/jobs/7?jobId=7&utm_source=linkedin')).toBe('https://example.com/jobs/7?jobId=7');
  });

  it('strips apply?source=LinkedIn on a Workday-style apply link', () => {
    expect(cleanJobPostLink('https://acme.wd5.myworkdayjobs.com/en-US/External/job/123/apply?source=LinkedIn')).toBe(
      'https://acme.wd5.myworkdayjobs.com/en-US/External/job/123/apply'
    );
  });

  it('strips &source=LinkedIn_Slots, keeps jobId', () => {
    expect(cleanJobPostLink('https://example.com/jobs/1?jobId=1&source=LinkedIn_Slots')).toBe('https://example.com/jobs/1?jobId=1');
  });

  it('is case-insensitive on the deny-list key itself', () => {
    expect(cleanJobPostLink('https://example.com/apply?UTM_SOURCE=linkedin&jobId=9')).toBe('https://example.com/apply?jobId=9');
  });

  it('leaves non-tracker query params (job/req IDs) fully untouched when there is nothing to strip', () => {
    expect(cleanJobPostLink('https://example.com/jobs?jobId=42&req=REQ-1')).toBe('https://example.com/jobs?jobId=42&req=REQ-1');
  });

  it('passes through null/empty untouched', () => {
    expect(cleanJobPostLink(null)).toBeNull();
    expect(cleanJobPostLink(undefined)).toBeNull();
    expect(cleanJobPostLink('')).toBeNull();
  });

  it('falls back to the original string for an unparseable URL rather than throwing', () => {
    expect(cleanJobPostLink('not-a-url')).toBe('not-a-url');
  });
});

// ── B.2 · ATS detection ──────────────────────────────────────────────────────
describe('detectAtsSystem', () => {
  it('detects Greenhouse', () => {
    expect(detectAtsSystem('https://boards.greenhouse.io/acme/jobs/123')).toBe('Greenhouse');
  });

  it('detects Workday from a tenant subdomain', () => {
    expect(detectAtsSystem('https://acme.wd5.myworkdayjobs.com/en-US/External/job/123')).toBe('Workday');
  });

  it('detects Lever', () => {
    expect(detectAtsSystem('https://jobs.lever.co/acme/abcd-1234')).toBe('Lever');
  });

  it('detects SAP SuccessFactors via career.sap.com', () => {
    expect(detectAtsSystem('https://career.sap.com/job/Vienna/Finance-Manager_123')).toBe('SAP SuccessFactors');
  });

  it('returns null for an unrecognized domain, leaving B4 to fall back', () => {
    expect(detectAtsSystem('https://www.linkedin.com/jobs/view/1234567')).toBeNull();
  });

  it('detects Onlyfy (formerly softgarden), incl. tenant subdomain — the real destination behind the AWS/Vienna lead (08bec87c-c797-4804-9f24-081c00ac4395)', () => {
    expect(detectAtsSystem('https://aws.onlyfy.jobs/job/v7rnl0dp')).toBe('Onlyfy (formerly softgarden)');
    expect(detectAtsSystem('https://acme.onlyfy.jobs/job/xyz')).toBe('Onlyfy (formerly softgarden)');
  });

  it('does not false-positive on a lookalike domain that merely contains onlyfy.jobs as a prefix', () => {
    expect(detectAtsSystem('https://onlyfy.jobs.evil.com/job/xyz')).toBeNull();
  });

  it('returns null for null/unparseable input', () => {
    expect(detectAtsSystem(null)).toBeNull();
    expect(detectAtsSystem('not-a-url')).toBeNull();
  });
});

// ── B.3 · off-site apply link candidates (LinkedIn capture) ─────────────────
describe('pickCandidateJobPostLink', () => {
  it('picks the first candidate matching a known ATS domain, tracker-stripped', () => {
    const out = pickCandidateJobPostLink([
      'https://www.some-random-agency.com/about',
      'https://boards.greenhouse.io/acme/jobs/123?jobId=123&utm_source=linkedin',
      'https://jobs.lever.co/acme/xyz',
    ]);
    expect(out).toEqual({ jobPostLink: 'https://boards.greenhouse.io/acme/jobs/123?jobId=123', atsSystem: 'Greenhouse' });
  });

  it('skips non-ATS candidates and stops at the first hit, ignoring later matches', () => {
    const out = pickCandidateJobPostLink(['https://acme.com/careers', 'https://jobs.lever.co/acme/1', 'https://boards.greenhouse.io/acme/2']);
    expect(out?.atsSystem).toBe('Lever');
  });

  it('returns null when no candidate matches a known ATS — Easy Apply / no off-site link falls back cleanly', () => {
    expect(pickCandidateJobPostLink(['https://www.linkedin.com/jobs/view/123', 'https://media.licdn.com/x.png'])).toBeNull();
    expect(pickCandidateJobPostLink([])).toBeNull();
    expect(pickCandidateJobPostLink(null)).toBeNull();
    expect(pickCandidateJobPostLink(undefined)).toBeNull();
  });

  it('unwraps an Iventa agency-redirect candidate to the real ATS behind it — the exact real hrefs from the AWS/Vienna lead (08bec87c-c797-4804-9f24-081c00ac4395)', () => {
    const out = pickCandidateJobPostLink([
      'https://iventajobdata.eu/bestmedia/img/2437680/1970203/cl/1030bd6c0b9e1e77b98391fdc2aac2789426352e/L10032705#67e18ceaca701b2a3b9cace6f2453bd4hyLDqEORnh',
      'https://iventajobdata.eu/bestmedia/img/2437680/1970203/cl/7e24cf81b57770ba3d03bdb56ed6794dc127bdac/L10032708/JeyJvbGRsaW5rIjoiaHR0cHM6Ly9hd3Mub25seWZ5LmpvYnMvam9iL3Y3cm5sMGRwIiwiemwiOiJMaW5rZWRJbiJ9',
      'https://iventajobdata.eu/bestmedia/img/2437680/1970203/cl/6869b73f2fa20d5af32fe13922b9fa89f654cfd5/L10032709/JeyJvbGRsaW5rIjoiaHR0cHM6Ly93d3cuYXdzLmF0LyIsInpsIjoiTGlua2VkSW4ifQ==',
    ]);
    expect(out).toEqual({ jobPostLink: 'https://aws.onlyfy.jobs/job/v7rnl0dp', atsSystem: 'Onlyfy (formerly softgarden)', viaAgency: 'Iventa' });
  });

  it('does not choke on an Iventa-hosted link whose last segment is not a decodable redirect', () => {
    expect(
      pickCandidateJobPostLink(['https://iventajobdata.eu/bestmedia/img/2437680/1970203/cl/abc/L10032705#not-a-redirect'])
    ).toBeNull();
  });
});

// ── C · AI extraction pass (mock fixture) ────────────────────────────────────
// Tested against real captured JDs already sitting in Storage — the real
// messy DOM-scraped text this pass has to work over, not synthetic prose.
function loadCapture(id: string): string {
  return fs.readFileSync(path.join(process.cwd(), '.storage', 'jd-captures', id, 'raw.md'), 'utf8');
}

describe('mockCaptureExtraction (real captured JDs)', () => {
  it('GlobalConnect (188): city from the LinkedIn header line, unspecified remote, catches the "no cover letter" signal', () => {
    const out = mockCaptureExtraction(loadCapture('188'));
    expect(out.city).toBe('Copenhagen');
    expect(out.remote).toBe('unspecified');
    expect(out.company).toBeNull(); // never guessed from prose — left for the live LLM
    expect(out.formatSignals).toMatch(/no need for a personal letter/i);
  });

  it('Österreichische Post (180): city from the header line, catches the recruiter contact name', () => {
    const out = mockCaptureExtraction(loadCapture('180'));
    expect(out.city).toBe('Vienna');
    expect(out.remote).toBe('unspecified');
    expect(out.company).toBeNull();
    expect(out.formatSignals).toMatch(/recruiterin melanie/i);
  });

  it('Miro (149): explicit "hybrid" is detected, no format signals present', () => {
    const out = mockCaptureExtraction(loadCapture('149'));
    expect(out.city).toBe('Amsterdam');
    expect(out.remote).toBe('hybrid');
    expect(out.company).toBeNull();
    expect(out.formatSignals).toBeNull();
  });
});
