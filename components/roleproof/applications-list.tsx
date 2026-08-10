'use client';

/**
 * The Applications tab — one unified list of everything still in play
 * (CI · Scoring Phase Redesign Part 2, §2.2.D).
 *
 * `response_pending` and `interview` rows live in the *same* list, not two
 * screens: an application waiting for word and one with an interview booked are
 * the same object at two moments, and splitting them would mean checking two
 * places to answer "what's outstanding". Only the status pill and a few extra
 * columns differ.
 *
 * `screened_out` never appears here — a stopped application is already in the
 * Archive (§2.2.F), and the move happens on the drop with no extra click.
 *
 * The `stale` badge is the one idea worth keeping from the retired Returns panel
 * (§2.2.G): no word in 7+ days, said once, on the row it's about.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logDeclineAction, logInterviewScheduledAction, setInterviewAtAction } from '@/app/actions/monitoring';
import { applicationStatusLabel, isStaleApplication, STALE_AFTER_DAYS } from '@/lib/applications';
import { DeclinePopup } from './decline-popup';
import { EmailDropZone } from './email-drop-zone';
import { RpScore, cn } from './kit';

export type MonitoredRow = {
  id: string;
  leadId: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string | null;
  /** ISO strings — this is a client component; Dates don't cross that boundary well. */
  appliedAt: string | null;
  updatedAt: string;
  confirmationEmailLink: string | null;
  outcomeEmailLink: string | null;
  outcomeAt: string | null;
  interviewAt: string | null;
  overallFitScore: number | null;
};

/** `12 Jul 2026`, or a dash. en-GB throughout, matching the rest of the app. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** `<input type="datetime-local">` wants local wall-clock, not a UTC ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ManualForm = { leadId: string; kind: 'decline' | 'interview' };

export function ApplicationsList({ rows }: { rows: MonitoredRow[] }) {
  const router = useRouter();
  const [manual, setManual] = useState<ManualForm | null>(null);
  const [decline, setDecline] = useState<{ company: string | null; title: string; senderEmail: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recordDecline(row: MonitoredRow, link: string | null, at?: Date, contactEmail?: string | null) {
    setError(null);
    try {
      await logDeclineAction(row.leadId, { outcomeEmailLink: link, outcomeAt: at, contactEmail });
      setManual(null);
      // The status change and the Archive move already happened, with no extra
      // click. The pop-up is purely the reply assist — dismissing it reverts
      // nothing (§2.2.E).
      setDecline({ company: row.company, title: row.title, senderEmail: contactEmail ?? null });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
    }
  }

  async function recordInterview(
    row: MonitoredRow,
    link: string | null,
    at?: Date,
    interviewAt?: Date | null,
    contactEmail?: string | null
  ) {
    setError(null);
    try {
      await logInterviewScheduledAction(row.leadId, { outcomeEmailLink: link, outcomeAt: at, interviewAt, contactEmail });
      setManual(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Nothing outstanding</div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Applications appear here the moment you confirm one was sent. Drop the confirmation email
          onto a ready lead on the board to start tracking it.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-card border border-drop bg-drop-soft px-4 py-2.5 text-[13px] text-drop-deep">
          {error}
        </div>
      )}
      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
        {rows.map((row) => {
          const stale = isStaleApplication(
            {
              status: row.status,
              appliedAt: row.appliedAt ? new Date(row.appliedAt) : null,
              updatedAt: new Date(row.updatedAt),
            },
            new Date()
          );
          const isInterview = row.status === 'interview';
          const open = manual?.leadId === row.leadId ? manual : null;

          return (
            <div key={row.id} className="border-b border-hairline/70 px-5 py-4 last:border-0">
              <div className="flex items-start gap-4">
                <RpScore score={row.overallFitScore} className="w-12 shrink-0 text-[26px]" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/roleproof/leads/${row.leadId}`}
                    className="block truncate text-sm font-semibold text-ink hover:text-proof-deep"
                  >
                    {row.title}
                  </Link>
                  <div className="truncate text-xs text-ink-subtle">
                    {[row.company, row.city].filter(Boolean).join(' · ') || '—'}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                    <span>Sent {fmtDate(row.appliedAt)}</span>
                    {row.confirmationEmailLink && (
                      <a
                        href={row.confirmationEmailLink}
                        className="font-semibold text-proof hover:text-proof-deep"
                      >
                        Confirmation ↗
                      </a>
                    )}
                    {isInterview && <span>Invited {fmtDate(row.outcomeAt)}</span>}
                    {isInterview && row.outcomeEmailLink && (
                      <a
                        href={row.outcomeEmailLink}
                        className="font-semibold text-proof hover:text-proof-deep"
                      >
                        Invite ↗
                      </a>
                    )}
                    {isInterview && row.interviewAt && (
                      <span className="font-semibold text-ink">Interview {fmtDateTime(row.interviewAt)}</span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {stale && (
                    <span
                      title={`No word in ${STALE_AFTER_DAYS}+ days`}
                      className="rounded-full bg-caution-soft px-2.5 py-1 text-[11px] font-bold text-caution-deep"
                    >
                      stale
                    </span>
                  )}
                  <span
                    className={cn(
                      'whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold',
                      isInterview ? 'bg-proof-soft text-proof-deep' : 'bg-raised text-ink-muted'
                    )}
                  >
                    {applicationStatusLabel(row.status)}
                  </span>
                </div>
              </div>

              {/* ── The two drop targets (§2.2.D) ── */}
              <div className="mt-3 flex flex-wrap items-center gap-2 pl-16">
                {!isInterview && (
                  <EmailDropZone
                    leadId={row.leadId}
                    kind="interview"
                    label="Interview invited"
                    onCaptured={(link, emailDate, senderEmail) =>
                      recordInterview(row, link, emailDate ? new Date(emailDate) : undefined, undefined, senderEmail)
                    }
                    onManual={() => setManual({ leadId: row.leadId, kind: 'interview' })}
                  />
                )}
                {/* Available on interview rows too — a decline can land after the
                    interview, and that's still the same terminal move. */}
                <EmailDropZone
                  leadId={row.leadId}
                  kind="decline"
                  tone="drop"
                  label="Declined"
                  onCaptured={(link, emailDate, senderEmail) =>
                    recordDecline(row, link, emailDate ? new Date(emailDate) : undefined, senderEmail)
                  }
                  onManual={() => setManual({ leadId: row.leadId, kind: 'decline' })}
                />
                {isInterview && <InterviewAtField leadId={row.leadId} value={row.interviewAt} />}
              </div>

              {open && (
                <ManualEntry
                  kind={open.kind}
                  onCancel={() => setManual(null)}
                  onSubmit={(at, interviewAt) =>
                    open.kind === 'decline'
                      ? recordDecline(row, null, at)
                      : recordInterview(row, null, at, interviewAt)
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {decline && (
        <DeclinePopup
          company={decline.company}
          title={decline.title}
          senderEmail={decline.senderEmail}
          onClose={() => setDecline(null)}
        />
      )}
    </>
  );
}

/**
 * The interview date/time itself — the one field no dropped email carries, so
 * it's a real picker, not a display field (§2.2.A). Separate from the invite
 * drop because the invite arrives and the slot gets pinned down days apart.
 */
function InterviewAtField({ leadId, value }: { leadId: string; value: string | null }) {
  const router = useRouter();
  const [local, setLocal] = useState(toLocalInput(value));
  const [pending, startTransition] = useTransition();

  function save(next: string) {
    setLocal(next);
    startTransition(async () => {
      await setInterviewAtAction(leadId, next ? new Date(next) : null);
      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-muted">
      <span className="font-semibold">Interview</span>
      <input
        type="datetime-local"
        value={local}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
        className="rounded-[7px] border border-hairline bg-paper px-2 py-1 text-[12px] text-ink disabled:opacity-60"
      />
    </label>
  );
}

/**
 * The no-email fallback (§2.2.C's `openManualForm`) — pre-filled with today,
 * because "it arrived today" is true nearly every time it's used.
 */
function ManualEntry({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: 'decline' | 'interview';
  onCancel: () => void;
  onSubmit: (at: Date, interviewAt?: Date | null) => void | Promise<void>;
}) {
  const [at, setAt] = useState(todayInput());
  const [interviewAt, setInterviewAt] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 ml-16 rounded-card border border-hairline bg-raised/60 px-4 py-3">
      <div className="text-[12px] font-semibold text-ink">
        {kind === 'decline' ? 'No decline email to drop?' : 'No invite email to drop?'}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-ink-muted">
          <span className="block font-semibold">
            {kind === 'decline' ? 'Declined on' : 'Invited on'}
          </span>
          <input
            type="date"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="mt-1 rounded-[7px] border border-hairline bg-paper px-2 py-1 text-[12px] text-ink"
          />
        </label>
        {kind === 'interview' && (
          <label className="text-[11px] text-ink-muted">
            <span className="block font-semibold">Interview at (optional)</span>
            <input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
              className="mt-1 rounded-[7px] border border-hairline bg-paper px-2 py-1 text-[12px] text-ink"
            />
          </label>
        )}
        <button
          type="button"
          disabled={pending || !at}
          onClick={() =>
            startTransition(async () => {
              await onSubmit(new Date(at), interviewAt ? new Date(interviewAt) : null);
            })
          }
          className="rounded-[8px] bg-proof px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Record'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
