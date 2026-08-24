/**
 * CI · Lead Liveness Re-check and Not Pursued Reason Tags.
 *
 * The parse half, pinned. Fixtures are trimmed from the real guest fragments
 * fetched for three of the owner's own leads on 2026-08-23 — the class names
 * below are LinkedIn's, not invented, which is the only reason these tests are
 * worth anything.
 */
import { describe, it, expect } from 'vitest';
import { linkedInJobId, parsePostedDays, parsePosting } from '../pipeline/linkedin-posting';

// Real markup shape, abridged. Lead 4407636740 (Siemens) — closed.
const CLOSED = `
<div class="top-card-layout__entity-info">
  <h2 class="topcard__title">Strategy Project Leader (f/m/d) Management Consulting</h2>
  <a class="topcard__org-name-link">Siemens</a>
  <span class="posted-time-ago__text topcard__flavor--metadata">4 weeks ago</span>
  <figcaption class="num-applicants__figure topcard__flavor--metadata"></figcaption>
  <div class="closed-job closed-job__flavor topcard__flavor-row">
    <icon class="closed-job__icon closed-job__icon--error-pebble lazy-load"></icon>
    <span class="closed-job__flavor--closed">No longer accepting applications</span>
  </div>
</div>`;

// Lead 4439853274 — open: the closed block is simply absent.
const OPEN = `
<div class="top-card-layout__entity-info">
  <h2 class="topcard__title">Business Manager COO Switzerland</h2>
  <span class="posted-time-ago__text topcard__flavor--metadata">2 weeks ago</span>
</div>`;

describe('linkedInJobId', () => {
  it('reads the id from the canonical posting URL', () => {
    expect(linkedInJobId('https://www.linkedin.com/jobs/view/4407636740/')).toBe('4407636740');
  });

  it('survives tracking params and a missing trailing slash', () => {
    expect(linkedInJobId('https://linkedin.com/jobs/view/4407636740?trk=abc&refId=x')).toBe('4407636740');
  });

  it('reads the currentJobId form used by search URLs', () => {
    expect(linkedInJobId('https://www.linkedin.com/jobs/search/?currentJobId=4418750507')).toBe('4418750507');
  });

  it('returns null for a non-LinkedIn host', () => {
    // 6 of the owner's leads point at Workday/Eightfold/onlyfy/etc. Each would
    // need its own parser; they must fall through, not be half-handled.
    expect(linkedInJobId('https://bbva.wd3.myworkdayjobs.com/job/12345')).toBeNull();
  });

  it('is not fooled by a lookalike host', () => {
    expect(linkedInJobId('https://linkedin.com.evil.example/jobs/view/4407636740/')).toBeNull();
  });

  it('returns null for junk, empty and missing input', () => {
    expect(linkedInJobId('not a url')).toBeNull();
    expect(linkedInJobId('')).toBeNull();
    expect(linkedInJobId(null)).toBeNull();
  });
});

describe('parsePostedDays', () => {
  it('converts the units LinkedIn actually writes', () => {
    expect(parsePostedDays('3 days ago')).toBe(3);
    expect(parsePostedDays('2 weeks ago')).toBe(14);
    expect(parsePostedDays('4 weeks ago')).toBe(28);
    expect(parsePostedDays('2 months ago')).toBe(60);
    expect(parsePostedDays('1 year ago')).toBe(365);
  });

  it('floors anything under a day to 0', () => {
    expect(parsePostedDays('20 minutes ago')).toBe(0);
    expect(parsePostedDays('5 hours ago')).toBe(0);
    expect(parsePostedDays('Just now')).toBe(0);
  });

  it('counts a repost from the repost date', () => {
    expect(parsePostedDays('Reposted 2 weeks ago')).toBe(14);
  });

  it('returns null rather than guessing on an unparseable phrase', () => {
    expect(parsePostedDays('sometime last spring')).toBeNull();
    expect(parsePostedDays('')).toBeNull();
    expect(parsePostedDays(null)).toBeNull();
  });
});

describe('parsePosting', () => {
  it('detects a closed posting', () => {
    const read = parsePosting(CLOSED)!;
    expect(read.closed).toBe(true);
    expect(read.postedDays).toBe(28);
    expect(read.title).toBe('Strategy Project Leader (f/m/d) Management Consulting');
  });

  it('reads an open posting as open — the marker is simply absent', () => {
    const read = parsePosting(OPEN)!;
    expect(read.closed).toBe(false);
    expect(read.postedDays).toBe(14);
  });

  it('refuses to interpret a page it does not recognise', () => {
    // The failure that matters. An auth wall has no closed marker either, and
    // reading "no marker" as "still open" there would silently assert a live
    // posting from a page we never actually saw.
    expect(parsePosting('<html><body>Sign in to LinkedIn</body></html>')).toBeNull();
    expect(parsePosting('')).toBeNull();
  });

  it('still reports closure when only the marker survives a shape change', () => {
    expect(parsePosting('<span class="closed-job__flavor--closed">No longer accepting applications</span>')).toEqual({
      closed: true,
      postedDays: null,
      title: null,
    });
  });

  it('leaves postedDays null when the phrase is missing, without failing the read', () => {
    const read = parsePosting('<h2 class="topcard__title">Some role</h2>')!;
    expect(read.closed).toBe(false);
    expect(read.postedDays).toBeNull();
  });
});
