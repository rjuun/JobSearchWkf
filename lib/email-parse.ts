/**
 * Extracts the sent/received date and sender address from a dropped
 * confirmation/decline/interview email — the "phase 2" auto-extraction the CI
 * (Scoring Phase Redesign Part 2, §2.0) deliberately deferred in favor of a
 * today-prefilled manual form. Built once that gap was felt in practice: a
 * decline dropped today logged today as `outcomeAt`, not the date the
 * employer actually sent it.
 *
 * `.msg` is the designed-for case (Outlook Classic's real drag output,
 * confirmed in the CI) via `@kenjiuno/msgreader`. `.eml` (rare — OWA/New
 * Outlook) gets a small manual RFC822 header read rather than a second
 * dependency, since it's just text.
 */
import MsgReader from '@kenjiuno/msgreader';

export type EmailMeta = { date: Date | null; senderEmail: string | null };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function toValidDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMsg(buf: Buffer): EmailMeta {
  try {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const data = new MsgReader(view).getFileData();
    // Delivery time (received) over submit time (sent) — "Process Closed" means
    // when Reggie learned the outcome, not when the employer's server sent it.
    // Never `creationTime`: that's when the .msg was saved into RoleProof's own
    // storage (today), not anything about the email itself.
    const date = toValidDate(data.messageDeliveryTime) ?? toValidDate(data.clientSubmitTime);
    // `senderSmtpAddress` is always a real SMTP address when Exchange attaches it.
    // `senderEmail` can instead be an X.500 DN (`/O=EXCHANGELABS/...`) when
    // `senderAddressType === 'EX'` — reject anything that doesn't look like an
    // email address rather than saving a DN into `contact_email`.
    const candidate = data.senderSmtpAddress || data.senderEmail || null;
    const senderEmail = candidate && EMAIL_RE.test(candidate) ? candidate : null;
    return { date, senderEmail };
  } catch {
    return { date: null, senderEmail: null };
  }
}

function parseEml(text: string): EmailMeta {
  // Header block only — cheap enough that the full MIME body doesn't need parsing
  // for the two fields this cares about.
  const dateLine = text.match(/^Date:\s*(.+)$/im)?.[1]?.trim();
  const fromLine = text.match(/^From:\s*(.+)$/im)?.[1]?.trim();
  return {
    date: toValidDate(dateLine),
    senderEmail: fromLine?.match(EMAIL_RE)?.[0] ?? null,
  };
}

/** Best-effort — a parse failure or an unrecognised extension yields both fields null, never throws. */
export function parseEmailArtifact(buf: Buffer, filename: string): EmailMeta {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (ext === '.msg') return parseMsg(buf);
  if (ext === '.eml') return parseEml(buf.toString('utf8'));
  return { date: null, senderEmail: null };
}
