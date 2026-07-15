/**
 * R3 · The Statement digest email — the thin adapter, deliberately last.
 *
 * Same projection as the in-app re-entry banner (`digestSince` → `digestHeadline`),
 * just delivered off-app. It is OFF by default (`NEXT_STATEMENT_EMAIL`) and has no
 * trigger wired yet: the banner ships first (zero infra), and this only earns a
 * monthly cron once the banner shows people return. Until then it's a console
 * transport in dev; swap `deliver` for Resend when the trigger is added.
 *
 * Kept server-side (imports env + the activity projection) — never bundle into a
 * client component.
 */
import { env } from '@/lib/env';
import { digestHeadline, type StatementDigest } from '@/lib/activity';

export type StatementEmail = { subject: string; body: string };

/** Pure: format a digest into a subject + body. Testable, transport-free. */
export function renderStatementEmail(name: string | null, digest: StatementDigest): StatementEmail {
  const who = name ? name.split(' ')[0] : 'there';
  const headline = digestHeadline(digest.totals);
  const lines = digest.latest.map((r) => `· ${r.summary ?? r.kind.replace(/_/g, ' ')}`);
  return {
    subject: `Your search moved: ${headline}`,
    body: [
      `Hi ${who},`,
      '',
      `Since you last looked at your Statement: ${headline}.`,
      ...(lines.length ? ['', ...lines] : []),
      '',
      'See the full picture → /statement',
    ].join('\n'),
  };
}

/**
 * Best-effort send. No-op unless the flag is on; console transport in dev. Returns
 * whether anything was dispatched so a future cron can count sends.
 */
export async function sendStatementDigest(to: string, email: StatementEmail): Promise<boolean> {
  if (!env.nextStatementEmail) return false;
  try {
    // TODO(R3): swap for a Resend call when the monthly trigger is wired.
    console.log(`[statement-email] → ${to}: ${email.subject}`);
    return true;
  } catch {
    return false;
  }
}
