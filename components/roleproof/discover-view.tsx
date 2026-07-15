'use client';

/**
 * Discover view (Additive Plan · C2) — Mirror + Unexpected Doors. Mirror cards
 * reflect who your evidence says you are; door cards surface adjacent shapes you
 * score well on but may not have considered. Scores come from the existing B6
 * requirement-alignment formula (server-side); this is presentation + reactions.
 *
 * Reaction signals: `discover · open` (mount), `· disagree` (a Mirror card
 * dismissed as not-me), `· flag_target` (a door materialised into a target lead).
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { flagDoorAsTargetAction, trackDiscoverAction } from '@/app/actions/discover';
import type { DoorVerdict } from '@/lib/discover';
import { DoorVerdictPanel } from './door-verdict';
import { cn } from './kit';

export type DiscoverArchetype = {
  key: string;
  title: string;
  family: string;
  blurb: string;
  fit: number;
  covered: number;
  total: number;
  gaps: string[];
  verdict?: DoorVerdict; // R4 · attached server-side for doors (Test a Door)
};

function fitTone(fit: number): string {
  return fit >= 7 ? 'text-proof' : fit >= 5.5 ? 'text-caution' : 'text-ink-muted';
}

export function DiscoverView({ mirror, doors }: { mirror: DiscoverArchetype[]; doors: DiscoverArchetype[] }) {
  const emitted = useRef(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!emitted.current) {
      emitted.current = true;
      void trackDiscoverAction('open');
    }
  }, []);

  const visibleMirror = mirror.filter((m) => !dismissed.has(m.key));

  function disagree(key: string) {
    setDismissed((s) => new Set(s).add(key));
    void trackDiscoverAction('disagree', key);
  }

  if (mirror.length === 0 && doors.length === 0) {
    return (
      <div className="mt-6 rounded-card border border-hairline bg-surface p-10 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Not enough evidence yet</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Discover matches role shapes against your Career Graph. Strengthen it with your coach or import more history, then come
          back to see what reflects you — and what doors might open.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      {visibleMirror.length > 0 && (
        <section>
          <div className="mb-1 flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-ink">Mirror</h2>
            <span className="text-[12px] text-ink-subtle">roles your evidence already reflects</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleMirror.map((m) => (
              <div key={m.key} className="flex flex-col rounded-card border border-hairline bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-ink">{m.title}</div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{m.family}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={cn('font-serif text-[26px] leading-none tabular-nums', fitTone(m.fit))}>{m.fit.toFixed(1)}</span>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">fit</div>
                  </div>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{m.blurb}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11.5px] text-ink-subtle">{m.covered}/{m.total} must-haves covered</span>
                  <button
                    type="button"
                    onClick={() => disagree(m.key)}
                    className="text-[11.5px] font-semibold text-ink-subtle transition hover:text-drop-deep"
                  >
                    Not me ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {doors.length > 0 && (
        <section>
          <div className="mb-1 flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-ink">Unexpected doors</h2>
            <span className="text-[12px] text-ink-subtle">adjacent roles you score well on</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {doors.map((d) => (
              <DoorCard key={d.key} door={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DoorCard({ door }: { door: DiscoverArchetype }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // `viaVerdict` distinguishes a flag that came *after* testing (R4's key signal)
  // from today's one-click flag straight off the card.
  function flag(viaVerdict: boolean) {
    if (viaVerdict) void trackDiscoverAction('door_verdict_flag', door.key);
    start(async () => {
      const res = await flagDoorAsTargetAction(door.key);
      if ('leadId' in res) router.push(`/roleproof/leads/${res.leadId}`);
      else router.refresh();
    });
  }

  function toggleTest() {
    setTesting((v) => {
      const next = !v;
      if (next) void trackDiscoverAction('door_test', door.key);
      return next;
    });
  }

  function disagreeVerdict() {
    // Distinct from a Mirror "not me" — this is a *tested* door's verdict being rejected,
    // the signal R4 measures ("does the honest verdict change minds?"). Keep it separate.
    void trackDiscoverAction('door_verdict_disagree', door.key);
    setDismissed(true);
    setTesting(false);
  }

  return (
    <div className="flex flex-col rounded-card border border-proof-ring/60 bg-proof-soft/20 p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink">{door.title}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{door.family}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className={cn('font-serif text-[26px] leading-none tabular-nums', fitTone(door.fit))}>{door.fit.toFixed(1)}</span>
          <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">fit</div>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{door.blurb}</p>
      {!testing && door.gaps.length > 0 && (
        <div className="mt-2 text-[11.5px] text-ink-subtle">
          You’d strengthen: <span className="text-caution-deep">{door.gaps.slice(0, 2).join(' · ')}</span>
        </div>
      )}

      {/* R4 · Test a Door — an honest verdict before committing. Flag stays available. */}
      {testing && door.verdict && !dismissed ? (
        <DoorVerdictPanel
          door={door}
          verdict={door.verdict}
          pending={pending}
          onFlag={() => flag(true)}
          onDisagree={disagreeVerdict}
        />
      ) : (
        <div className="mt-3 flex items-center gap-2.5">
          {door.verdict && (
            <button
              type="button"
              onClick={toggleTest}
              className="rounded-[9px] border border-proof-ring bg-surface px-4 py-2 text-[12px] font-bold text-proof-deep transition hover:bg-proof-soft/60"
            >
              Test this door →
            </button>
          )}
          <button
            type="button"
            onClick={() => flag(false)}
            disabled={pending}
            className="rounded-[9px] bg-proof px-4 py-2 text-[12px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
          >
            {pending ? 'Flagging…' : 'Flag as target →'}
          </button>
        </div>
      )}
    </div>
  );
}
