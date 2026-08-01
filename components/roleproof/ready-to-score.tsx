'use client';

/**
 * The Ready to score tab — the batch, and the runner that works through it.
 *
 * The loop is deliberately sequential, not Promise.all. That's the whole point
 * of batching: B5/B6's system prompts are cached with a 1h TTL, and calls that
 * land seconds apart hit that cache where today's one-lead-every-few-hours
 * pattern re-pays the cold write every time. Running them concurrently would
 * also stack N Opus B6 calls against one function's duration budget.
 *
 * Stuck leads: runScoring marks a lead `screening` before B4 starts, so a hard
 * Vercel kill mid-batch strands it there — invisible to this tab's `selected`
 * query and to Results. Any `screening` row whose updatedAt has gone stale gets
 * a retry affordance instead. Retrying is safe by construction: B4/B6 overwrite
 * columns and B5 skips re-extraction when job_requirements rows already exist,
 * so runScoring can just be called again from the top.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { runScoringAction } from '@/app/actions/pipeline';
import { markNotPursuedAction } from '@/app/actions/scoring-queue';
import { cn } from './kit';

/** Comfortably past even a generous maxDuration, so a slow run isn't called stuck. */
const STUCK_AFTER_MS = 2 * 60 * 1000;

export type ScorableLead = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  status: string;
  updatedAt: string;
  /** No roadblocks and no misalignments — reached `selected` without a human click. */
  autoSelected: boolean;
};

type RowState = 'idle' | 'running' | 'done' | 'error';

export function ReadyToScore({ ready, running }: { ready: ScorableLead[]; running: ScorableLead[] }) {
  const router = useRouter();
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  // Leads sent to Not Pursued optimistically drop out of view before the
  // server round-trip (revalidatePath) actually re-fetches this list.
  const [notPursued, setNotPursued] = useState<Record<string, boolean>>({});
  const [notPursuing, setNotPursuing] = useState<Record<string, boolean>>({});

  // Re-render on a timer so "stuck" appears while the user is watching, rather
  // than only after a navigation. Cheap: one tick every 15s, and only while
  // there is something in flight to watch.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (running.length === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [running.length]);

  async function runOne(id: string) {
    setStates((s) => ({ ...s, [id]: 'running' }));
    try {
      await runScoringAction(id);
      setStates((s) => ({ ...s, [id]: 'done' }));
      return true;
    } catch (e) {
      setStates((s) => ({ ...s, [id]: 'error' }));
      setErrors((s) => ({ ...s, [id]: e instanceof Error ? e.message : 'Scoring failed.' }));
      return false;
    }
  }

  async function runBatch(ids: string[]) {
    setBatchRunning(true);
    setErrors({});
    // Sequential on purpose — see the module comment. One lead's failure must
    // not abandon the rest of the batch, so each is caught individually.
    for (const id of ids) {
      await runOne(id);
    }
    setBatchRunning(false);
    router.refresh();
  }

  async function notPursue(id: string) {
    setNotPursuing((s) => ({ ...s, [id]: true }));
    try {
      await markNotPursuedAction(id);
      setNotPursued((s) => ({ ...s, [id]: true }));
      router.refresh();
    } catch (e) {
      setNotPursuing((s) => ({ ...s, [id]: false }));
      setErrors((s) => ({ ...s, [id]: e instanceof Error ? e.message : 'Could not mark not pursued.' }));
    }
  }

  const stuckAll = running.filter((l) => Date.now() - new Date(l.updatedAt).getTime() > STUCK_AFTER_MS);
  const stuck = stuckAll.filter((l) => !notPursued[l.id]);
  const inFlight = running.filter((l) => !stuckAll.includes(l));
  const readyVisible = ready.filter((l) => !notPursued[l.id]);

  return (
    <div className="flex flex-col gap-6">
      {stuck.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-ink">
            Looks stuck{' '}
            <span className="ml-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-caution-deep">
              {stuck.length}
            </span>
          </h3>
          <p className="mb-3 text-[13px] text-ink-muted">
            These started scoring but never finished — most likely the function was cut off mid-run.
            Retrying is safe: it picks up from the top and overwrites whatever the partial run left.
          </p>
          <div className="overflow-hidden rounded-card border border-caution/40 bg-surface shadow-card">
            {stuck.map((l) => (
              <Row
                key={l.id}
                lead={l}
                state={states[l.id] ?? 'idle'}
                error={errors[l.id]}
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runOne(l.id).then(() => router.refresh())}
                      disabled={batchRunning || states[l.id] === 'running' || notPursuing[l.id]}
                      className="rounded-[9px] bg-caution-soft px-3 py-1.5 text-[12px] font-bold text-caution-deep transition hover:bg-caution hover:text-white disabled:opacity-50"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => notPursue(l.id)}
                      disabled={batchRunning || states[l.id] === 'running' || notPursuing[l.id]}
                      className="rounded-[9px] border border-hairline px-3 py-1.5 text-[12px] font-bold text-ink-muted transition hover:border-drop hover:text-drop disabled:opacity-50"
                    >
                      {notPursuing[l.id] ? 'Marking…' : 'Not pursued'}
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}

      {inFlight.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-ink">Scoring now</h3>
          <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            {inFlight.map((l) => (
              <Row key={l.id} lead={l} state="running" />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-ink">
            Ready to score{' '}
            {readyVisible.length > 0 && (
              <span className="ml-1 rounded-full bg-proof-soft px-2 py-0.5 text-[11px] font-semibold text-proof-deep">
                {readyVisible.length}
              </span>
            )}
          </h3>
          {readyVisible.length > 0 && (
            <button
              type="button"
              onClick={() => runBatch(readyVisible.map((l) => l.id))}
              disabled={batchRunning}
              className="rounded-[9px] bg-proof px-[18px] py-[11px] text-[13px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep disabled:opacity-60"
            >
              {batchRunning
                ? 'Running…'
                : `Run scoring · ${readyVisible.length} lead${readyVisible.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>

        {readyVisible.length === 0 ? (
          <div className="rounded-card border border-hairline bg-surface px-6 py-16 text-center shadow-card">
            <div className="font-serif text-2xl text-ink">Nothing queued</div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
              Clean leads arrive here on their own once the initial checks pass. Flagged ones show up
              after you clear them in the Queue.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
            {readyVisible.map((l) => (
              <Row
                key={l.id}
                lead={l}
                state={states[l.id] ?? 'idle'}
                error={errors[l.id]}
                action={
                  <button
                    type="button"
                    onClick={() => notPursue(l.id)}
                    disabled={batchRunning || states[l.id] === 'running' || notPursuing[l.id]}
                    className="shrink-0 rounded-[9px] border border-hairline px-3 py-1.5 text-[12px] font-bold text-ink-muted transition hover:border-drop hover:text-drop disabled:opacity-50"
                  >
                    {notPursuing[l.id] ? 'Marking…' : 'Not pursued'}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const STATE_LABEL: Record<RowState, string> = {
  idle: 'Queued',
  running: 'Scoring…',
  done: 'Done',
  error: 'Failed',
};

function Row({
  lead,
  state,
  error,
  action,
}: {
  lead: ScorableLead;
  state: RowState;
  error?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-hairline/70 px-5 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/roleproof/leads/${lead.id}`}
          className="truncate text-sm font-semibold text-ink transition hover:text-proof"
        >
          {lead.title}
        </Link>
        <div className="truncate text-xs text-ink-subtle">
          {[lead.company, lead.city].filter(Boolean).join(' · ') || '—'}
        </div>
        {error && <div className="mt-1 text-[12px] font-medium text-drop">{error}</div>}
      </div>
      {/* Provenance badge — did this clear the gate on its own, or did you
          override a flag to get it here? */}
      <span
        className={cn(
          'hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex',
          lead.autoSelected ? 'bg-raised text-ink-muted' : 'bg-caution-soft text-caution-deep'
        )}
      >
        {lead.autoSelected ? 'auto · clean' : 'manual override'}
      </span>
      <span
        className={cn(
          'w-[72px] shrink-0 text-right text-[12px] font-bold',
          state === 'done' && 'text-proof',
          state === 'error' && 'text-drop',
          state === 'running' && 'text-caution-deep',
          state === 'idle' && 'text-ink-subtle'
        )}
      >
        {STATE_LABEL[state]}
      </span>
      {action}
    </div>
  );
}
