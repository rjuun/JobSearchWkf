/**
 * The two pieces of genuinely new logic in the D-phase monitoring surface
 * (CI · Scoring Phase Redesign Part 2, §2.3 step 12).
 *
 *  1. The drop handler's three-way branch — file / text link / neither. What
 *     actually lands in a DataTransfer is decided by the mail client, not by us:
 *     Outlook Classic hands over a real .msg through `files`, OWA tends to hand
 *     over a URL, and a drag across the wrong window boundary can hand over
 *     nothing at all. All three have to keep working, and the branch is easy to
 *     get subtly wrong (an empty FileList is truthy; `getData` throws outside a
 *     real drop event in some browsers). This is why `classifyEmailDrop` is pure
 *     and DOM-free rather than living inside the React hook — a node test can
 *     reach it, a DragEvent isn't available here at all.
 *
 *  2. The label map and the stale rule — the two things the retired Returns
 *     panel used to own (§2.2.G). The status *values* are shared with the old
 *     panel and only relabelled, so a wrong label here silently mislabels
 *     historical rows rather than failing loudly.
 */
import { describe, it, expect } from 'vitest';
import {
  APPLICATION_STATUS_LABEL,
  declineReplyText,
  applicationStatusLabel,
  classifyEmailDrop,
  emailArtifactExt,
  emailArtifactLink,
  emailArtifactObjectName,
  emailArtifactPath,
  isSafeObjectName,
  isStaleApplication,
  OPEN_APPLICATION_STATUSES,
  STALE_AFTER_DAYS,
} from '../applications';

const msg = () => new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'Re Your application.msg');

describe('the drop classifier: file / link / neither', () => {
  it('takes the file when Outlook Classic hands one over', () => {
    const file = msg();
    const drop = classifyEmailDrop({ files: [file], getData: () => '' });
    expect(drop).toEqual({ kind: 'file', file });
  });

  it('prefers the file even when a text shape is offered alongside it', () => {
    // Outlook hands over several flavours at once; the file is the one worth keeping.
    const drop = classifyEmailDrop({ files: [msg()], getData: () => 'https://outlook.office.com/…' });
    expect(drop.kind).toBe('file');
  });

  it('falls back to text/uri-list when there is no file', () => {
    const drop = classifyEmailDrop({
      files: [],
      getData: (f) => (f === 'text/uri-list' ? 'https://mail.example/msg/42' : ''),
    });
    expect(drop).toEqual({ kind: 'link', url: 'https://mail.example/msg/42' });
  });

  it('falls back to text/plain when uri-list is empty', () => {
    const drop = classifyEmailDrop({
      files: null,
      getData: (f) => (f === 'text/plain' ? '  https://mail.example/msg/7  ' : ''),
    });
    expect(drop).toEqual({ kind: 'link', url: 'https://mail.example/msg/7' });
  });

  it('reports nothing usable when both shapes are empty — the manual form case', () => {
    expect(classifyEmailDrop({ files: [], getData: () => '' })).toEqual({ kind: 'none' });
    expect(classifyEmailDrop({ files: [], getData: () => '   ' })).toEqual({ kind: 'none' });
  });

  it('treats a zero-byte file as no file and keeps looking', () => {
    const empty = new File([], 'empty.msg');
    const drop = classifyEmailDrop({ files: [empty], getData: () => 'https://mail.example/msg/9' });
    expect(drop).toEqual({ kind: 'link', url: 'https://mail.example/msg/9' });
  });

  it('survives a getData that throws, and a missing dataTransfer entirely', () => {
    const drop = classifyEmailDrop({
      files: [],
      getData: () => {
        throw new Error('not allowed outside a drop event');
      },
    });
    expect(drop).toEqual({ kind: 'none' });
    expect(classifyEmailDrop(null)).toEqual({ kind: 'none' });
    expect(classifyEmailDrop({})).toEqual({ kind: 'none' });
  });
});

describe('where a dropped email is stored', () => {
  it('keeps a recognised extension and defaults everything else to .msg', () => {
    expect(emailArtifactExt('a.msg')).toBe('.msg');
    expect(emailArtifactExt('a.EML')).toBe('.eml');
    expect(emailArtifactExt('a.exe')).toBe('.msg');
    expect(emailArtifactExt('no-extension')).toBe('.msg');
    expect(emailArtifactExt(null)).toBe('.msg');
  });

  it('names the object by kind and timestamp, with nothing a path could use', () => {
    const at = new Date('2026-07-28T20:15:30.000Z');
    const name = emailArtifactObjectName('decline', 'Absage.msg', at);
    expect(name).toBe('decline-2026-07-28T20-15-30-000Z.msg');
    expect(isSafeObjectName(name)).toBe(true);
  });

  it('scopes the path per lead, so two leads never collide', () => {
    const name = emailArtifactObjectName('confirmation', 'x.msg', new Date('2026-07-28T00:00:00Z'));
    expect(emailArtifactPath('lead-a', name)).toBe(`applications/lead-a/${name}`);
    expect(emailArtifactPath('lead-b', name)).not.toBe(emailArtifactPath('lead-a', name));
  });

  it('stores an href, not a bucket path — the column is read straight into a link', () => {
    expect(emailArtifactLink('lead-a', 'confirmation-x.msg')).toBe(
      '/api/applications/lead-a/email/confirmation-x.msg'
    );
  });

  it('rejects traversal and subpaths in an object name', () => {
    expect(isSafeObjectName('../../etc/passwd')).toBe(false);
    expect(isSafeObjectName('a/b.msg')).toBe(false);
    expect(isSafeObjectName('.hidden')).toBe(false);
    expect(isSafeObjectName('fine-1.msg')).toBe(true);
  });
});

describe('the Applications label map', () => {
  it('relabels the statuses the Returns panel used to own', () => {
    expect(applicationStatusLabel('response_pending')).toBe('Response pending');
    expect(applicationStatusLabel('interview')).toBe('Interview scheduled');
    expect(applicationStatusLabel('screened_out')).toBe('Stopped');
    expect(applicationStatusLabel('offer')).toBe('Offer');
  });

  it('covers every status the old panel could show, so no historical row goes blank', () => {
    for (const status of ['downloaded', 'applied', 'response', 'interview', 'offer', 'screened_out']) {
      expect(APPLICATION_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it('falls back to the raw value rather than rendering nothing', () => {
    expect(applicationStatusLabel('something_new')).toBe('something_new');
    expect(applicationStatusLabel(null)).toBe('Not tracked');
  });

  it('lists exactly the two statuses the Applications list renders', () => {
    expect([...OPEN_APPLICATION_STATUSES]).toEqual(['response_pending', 'interview']);
  });
});

describe('the stale badge', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('flags a response_pending row with no word for 7+ days', () => {
    const at = daysAgo(STALE_AFTER_DAYS + 2);
    expect(isStaleApplication({ status: 'response_pending', appliedAt: at, updatedAt: at })).toBe(true);
  });

  it('does not flag one inside the window', () => {
    const at = daysAgo(2);
    expect(isStaleApplication({ status: 'response_pending', appliedAt: at, updatedAt: at })).toBe(false);
  });

  it('counts from the last touch, not the send date — a row that moved is not silent', () => {
    expect(
      isStaleApplication({ status: 'response_pending', appliedAt: daysAgo(30), updatedAt: daysAgo(1) })
    ).toBe(false);
  });

  it('never flags an interview row — that is scheduled, not silent', () => {
    const at = daysAgo(60);
    expect(isStaleApplication({ status: 'interview', appliedAt: at, updatedAt: at })).toBe(false);
    expect(isStaleApplication({ status: 'screened_out', appliedAt: at, updatedAt: at })).toBe(false);
  });

  it('never flags a row with no send date to count from', () => {
    expect(isStaleApplication({ status: 'response_pending', appliedAt: null, updatedAt: null })).toBe(false);
  });
});

describe('the decline reply template', () => {
  it('names the company', () => {
    expect(declineReplyText('Testhaus GmbH')).toContain('Testhaus GmbH');
  });

  it('stays a sendable sentence when the company is unknown', () => {
    const text = declineReplyText(null);
    expect(text).toContain('your organisation');
    expect(text).not.toContain('null');
    expect(declineReplyText('   ')).toContain('your organisation');
  });
});
