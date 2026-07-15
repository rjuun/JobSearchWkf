'use client';

/**
 * R1 · Interview Armament — the dedicated night-before surface (board #2c/#3c).
 * The inline teaser in the CV-ready panel shows a capped preview; this is the full
 * brief on its own route, print-optimised for reading the night before the call.
 *
 * Nothing here is invented — it renders the pure `buildInterviewBrief` projection
 * of evidence the user already kept and the role's own requirements. Emits the
 * reaction signal `interview_brief · open` (page load, server) · `expand_req`
 * (a probe expanded) · `print`.
 */
import { useRef, useState } from 'react';
import { trackUxAction } from '@/app/actions/ux';
import type { InterviewBrief } from '@/lib/interview';
import { cn } from './kit';

export function InterviewBriefFull({
  leadId,
  title,
  company,
  brief,
}: {
  leadId: string;
  title: string;
  company: string | null;
  brief: InterviewBrief;
}) {
  const expanded = useRef<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggleProbe(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // One expand_req per requirement, the first time it's opened.
        if (!expanded.current.has(key)) {
          expanded.current.add(key);
          void trackUxAction('interview_brief', 'expand_req', leadId);
        }
      }
      return next;
    });
  }

  function onPrint() {
    void trackUxAction('interview_brief', 'print', leadId);
    if (typeof window !== 'undefined') window.print();
  }

  const { proofPoints, probes, bridges, leftOut, graphLesson, counts } = brief;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-proof-deep">Interview brief</div>
        <h1 className="mt-1 font-serif text-[26px] leading-tight text-ink">
          {title}
          {company ? <span className="text-ink-muted"> · {company}</span> : null}
        </h1>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-muted">{graphLesson}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
          <button
            type="button"
            onClick={onPrint}
            className="rounded-[9px] bg-ink px-4 py-2 text-[12.5px] font-bold text-paper transition hover:opacity-90"
          >
            ⎙ Print brief
          </button>
          <a
            href={`/roleproof/leads/${leadId}`}
            className="text-[12.5px] font-semibold text-ink-muted underline transition hover:text-ink"
          >
            Back to the workspace
          </a>
        </div>
        <p className="mt-2 text-[11px] text-ink-subtle">
          Built from the evidence you kept and this role&rsquo;s must-haves — nothing here is invented.
        </p>
      </div>

      {/* Nothing to project yet */}
      {counts.proof === 0 && counts.probe === 0 ? (
        <div className="rounded-card border border-hairline bg-surface px-5 py-8 text-center text-[13px] text-ink-muted shadow-card">
          Keep evidence onto this CV and score the role — the brief fills in from there.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Section
            title="Lead with these — proof already on your CV"
            tone="proof"
            count={counts.proof}
            empty="No kept evidence yet."
          >
            {proofPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-3 text-[13px]">
                <span className="mt-0.5 shrink-0 text-proof">✓</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ink">{p.bullet}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-subtle">
                    {p.ref && (
                      <span className="rounded bg-proof-soft px-1.5 py-0.5 font-mono font-semibold text-proof-deep ring-1 ring-inset ring-proof-ring">
                        {p.ref}
                      </span>
                    )}
                    {p.connection && <span className="text-ink-muted">{p.connection}</span>}
                  </span>
                </span>
              </li>
            ))}
          </Section>

          <Section
            title="Expect to be pressed on"
            tone="ink"
            count={counts.probe}
            hint="Tap a must-have to see what the posting asks."
            empty="No Core or Important requirements captured."
          >
            {probes.map((p, i) => {
              const key = `${i}:${p.requirement}`;
              const isOpen = open.has(key);
              const hasMore = Boolean(p.description);
              return (
                <li key={key} className="text-[13px]">
                  <button
                    type="button"
                    onClick={() => hasMore && toggleProbe(key)}
                    aria-expanded={isOpen}
                    className={cn(
                      'flex w-full items-start gap-3 px-5 py-3 text-left',
                      hasMore && 'transition hover:bg-raised/50'
                    )}
                  >
                    <span className="mt-0.5 shrink-0 text-ink-subtle">⌖</span>
                    <span className="min-w-0 flex-1 text-ink-muted">
                      {p.requirement}
                      <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                        {p.rank}
                      </span>
                    </span>
                    {hasMore && (
                      <span className={cn('shrink-0 text-ink-subtle transition print:hidden', isOpen && 'rotate-90')}>▸</span>
                    )}
                  </button>
                  {hasMore && (isOpen || false) && (
                    <div className="border-t border-hairline bg-raised/40 px-5 py-3 pl-11 text-[12px] leading-relaxed text-ink-muted">
                      {p.description}
                    </div>
                  )}
                </li>
              );
            })}
          </Section>

          {bridges.length > 0 && (
            <Section title="Prepare an honest bridge for" tone="caution" count={counts.bridge}>
              {bridges.map((b, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3 text-[13px] text-caution-deep">
                  <span className="mt-0.5 shrink-0">⚐</span>
                  <span className="min-w-0 flex-1">
                    {b.requirement}
                    <span className="ml-2 text-[11px] text-caution">{b.strength} match — don&rsquo;t oversell it</span>
                  </span>
                </li>
              ))}
            </Section>
          )}

          {leftOut.length > 0 && (
            <Section
              title="Left out, on purpose"
              tone="ink"
              count={counts.leftOut}
              hint="Not on the CV — but if they ask, here&rsquo;s your honest answer. Shown, not faked."
            >
              {leftOut.map((l, i) => (
                <li key={i} className="px-5 py-3 text-[12.5px]">
                  <div className="font-semibold text-ink">{l.requirement}</div>
                  <div className="mt-0.5 text-ink-muted">{l.note}</div>
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  count,
  hint,
  empty,
  children,
}: {
  title: string;
  tone: 'proof' | 'ink' | 'caution';
  count: number;
  hint?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-5 py-3">
        <div
          className={cn(
            'text-[11px] font-semibold uppercase tracking-[0.08em]',
            tone === 'proof' && 'text-proof-deep',
            tone === 'ink' && 'text-ink-subtle',
            tone === 'caution' && 'text-caution-deep'
          )}
        >
          {title}
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{count}</span>
      </div>
      {count === 0 ? (
        <div className="px-5 py-4 text-[12px] text-ink-subtle">{empty ?? 'Nothing here.'}</div>
      ) : (
        <>
          {hint && <div className="border-b border-hairline px-5 py-2 text-[11px] text-ink-subtle">{hint}</div>}
          <ul className="flex flex-col divide-y divide-hairline">{children}</ul>
        </>
      )}
    </section>
  );
}
