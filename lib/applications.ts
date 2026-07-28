/**
 * D-phase (monitoring) helpers — pure, so they can be imported by both the
 * server actions in app/actions/monitoring.ts (a 'use server' module, which may
 * only export async functions) and by the client components that render the
 * Applications / Archive lists.
 *
 * See CI · Scoring Phase Redesign — Part 2, §2.2.A/D/F.
 */

/** Which of the three drop targets an archived email came from. */
export type EmailArtifactKind = 'confirmation' | 'decline' | 'interview';

/**
 * `applications.status` as this phase uses it. `response_pending` is the one new
 * value; the rest already existed in app/actions/monitoring.ts's ALLOWED_OUTCOMES
 * and are only relabelled here — no data migration, existing rows keep meaning.
 */
export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  downloaded: 'CV downloaded',
  applied: 'Applied',
  response_pending: 'Response pending',
  response: 'Response received',
  interview: 'Interview scheduled',
  offer: 'Offer',
  screened_out: 'Stopped',
};

export function applicationStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Not tracked';
  return APPLICATION_STATUS_LABEL[status] ?? status;
}

/** The two statuses the Applications list renders. `screened_out` lives in the Archive. */
export const OPEN_APPLICATION_STATUSES = ['response_pending', 'interview'] as const;

/** The single status the Archive renders — stopped applications, nothing else. */
export const ARCHIVED_APPLICATION_STATUS = 'screened_out';

/** Days without a status change before a `response_pending` row is nudged. */
export const STALE_AFTER_DAYS = 7;

/**
 * "No word in 7+ days" — the one idea worth keeping from the retired Returns
 * panel (§2.2.G). Only applies while still waiting: an `interview` row isn't
 * stale, it's scheduled.
 */
export function isStaleApplication(
  row: { status: string | null; appliedAt: Date | null; updatedAt?: Date | null },
  now: Date = new Date()
): boolean {
  if (row.status !== 'response_pending') return false;
  // The later of the two: a row touched since it was sent isn't silent.
  const since = row.updatedAt && row.appliedAt && row.updatedAt > row.appliedAt ? row.updatedAt : row.appliedAt;
  if (!since) return false;
  const days = (now.getTime() - since.getTime()) / 86_400_000;
  return days >= STALE_AFTER_DAYS;
}

const SAFE_EXT = new Set(['.msg', '.eml', '.txt', '.pdf', '.html']);

/**
 * Keep the dropped file's extension when it's one we recognise, else call it a
 * `.msg` — Outlook Classic hands us a real `.msg` (CDFV2) via dataTransfer.files
 * and that's the shape this is built around (§2.2.C).
 */
export function emailArtifactExt(filename: string | null | undefined): string {
  const dot = filename ? filename.lastIndexOf('.') : -1;
  if (dot === -1) return '.msg';
  const ext = filename!.slice(dot).toLowerCase();
  return SAFE_EXT.has(ext) ? ext : '.msg';
}

/** Bucket-relative object name inside `applications/{leadId}/` — never a path. */
export function emailArtifactObjectName(
  kind: EmailArtifactKind,
  filename?: string | null,
  now: Date = new Date()
): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return `${kind}-${ts}${emailArtifactExt(filename)}`;
}

/** Where lib/storage.ts puts it. Mirrors the existing jd-captures/ + cv-output/ prefixes. */
export function emailArtifactPath(leadId: string, objectName: string): string {
  return `applications/${leadId}/${objectName}`;
}

/**
 * What goes in `confirmationEmailLink` / `outcomeEmailLink`: something you can
 * put straight in an href. For a dropped file that's this app's own
 * owner-scoped download route (the same pattern as /api/cv/[leadId] — not a
 * Supabase signed URL, which would both expire and not exist on the local-FS
 * backend). For a dropped text/uri-list the column just holds that URL as-is.
 */
export function emailArtifactLink(leadId: string, objectName: string): string {
  return `/api/applications/${leadId}/email/${encodeURIComponent(objectName)}`;
}

/** Rejects anything that isn't a bare object name — no traversal, no subpaths. */
export function isSafeObjectName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith('.') && !name.includes('..');
}

// ── The drop classifier (§2.2.C) ────────────────────────────────────────────
//
// Pure and DOM-free on purpose: what actually lands in a DataTransfer depends on
// the mail client, so this three-way branch is the part most worth unit-testing
// (§2.3 step 12), and it can't be if it needs a real browser DragEvent. The
// React hook that calls it is components/roleproof/use-email-drop.ts.

/** The parts of a DataTransfer this cares about. */
export type DropSource = {
  files?: ArrayLike<File> | null;
  getData?: ((format: string) => string) | null;
};

export type EmailDrop =
  | { kind: 'file'; file: File } //  Outlook Classic — the designed-for case
  | { kind: 'link'; url: string } // OWA / New Outlook / a dragged hyperlink
  | { kind: 'none' }; //            nothing usable — fall back to the manual form

export function classifyEmailDrop(source: DropSource | null | undefined): EmailDrop {
  if (!source) return { kind: 'none' };
  const file = source.files && source.files.length > 0 ? source.files[0] : null;
  // A zero-byte file isn't something worth archiving; try the text shapes before
  // giving up, since some clients hand over both.
  if (file && file.size > 0) return { kind: 'file', file };
  const read = (format: string): string => {
    try {
      return source.getData?.(format) ?? '';
    } catch {
      return '';
    }
  };
  const url = (read('text/uri-list') || read('text/plain')).trim();
  if (url) return { kind: 'link', url };
  return { kind: 'none' };
}

/**
 * The decline reply-assist template (§2.2.E). Lives here rather than in the
 * pop-up component so it can be unit-tested: vitest runs this repo's tsconfig,
 * which leaves `jsx: preserve`, so a .tsx module can't be imported from a test.
 */
export function declineReplyText(company: string | null | undefined): string {
  const who = company?.trim() || 'your organisation';
  return `Thank you for letting me know, and for considering my profile. I remain very interested in ${who} and would welcome being considered for future roles that fit my background.`;
}
