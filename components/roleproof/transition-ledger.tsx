import type { Ledger } from '@/lib/ledger';

/**
 * R6 · The Transition Ledger — the long, slow search reframed as accumulation. A
 * read-only projection: an honest summary of what N weeks built, and a month-by-month
 * timeline composed from strength snapshots, activity and story versions. No new data.
 */
export function TransitionLedger({ ledger }: { ledger: Ledger }) {
  // Self-gate: stay "still gathering" until there's real accumulation to show, so a
  // fresh or lightly-used account never sees a one-line ledger that undercuts the point.
  if (!ledger.substantive) {
    return (
      <div className="mt-8 rounded-card border border-hairline bg-surface p-10 text-center shadow-card">
        <div className="font-serif text-2xl text-ink">Your ledger is still gathering</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          A few more moves — keep evidence, tailor a CV, grow your story — and this becomes a real record of what these
          weeks built.
        </p>
      </div>
    );
  }

  const totals: { label: string; value: number }[] = [
    { label: 'evidence kept', value: ledger.totals.evidenceKept },
    { label: 'coached answers', value: ledger.totals.coachApproved },
    { label: 'CVs tailored', value: ledger.totals.cvsGenerated },
    { label: 'targets opened', value: ledger.totals.targetsFlagged },
    { label: 'story versions', value: ledger.totals.storyVersions },
  ];

  return (
    <>
      {/* Accumulation summary — the reframe: this wasn't a quiet month, it was a build. */}
      <div className="mt-7 flex flex-wrap items-center gap-5 rounded-card border border-proof-ring/60 bg-proof-soft/25 px-6 py-5 shadow-card">
        {ledger.currentStrength != null && (
          <div className="shrink-0 text-center">
            <div className="font-serif text-[40px] leading-none text-proof tabular-nums">{ledger.currentStrength}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-proof-deep">graph strength</div>
            {ledger.totalGain > 0 && <div className="mt-0.5 text-[11px] font-semibold text-proof">+{ledger.totalGain} over time</div>}
          </div>
        )}
        <p className="min-w-[220px] flex-1 text-[15px] leading-relaxed text-ink">{ledger.summaryLine}</p>
      </div>

      {/* Totals */}
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-card border border-hairline bg-surface shadow-card sm:grid-cols-5">
        {totals.map((t, i) => (
          <div key={t.label} className={i > 0 ? 'border-l border-hairline px-4 py-4' : 'px-4 py-4'}>
            <div className="font-serif text-[28px] leading-none tabular-nums text-ink">{t.value}</div>
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Month-by-month — what each stretch of the search actually built. */}
      <h2 className="mb-3 mt-9 text-sm font-bold text-ink">Month by month</h2>
      <div className="flex flex-col gap-3">
        {ledger.months.map((m) => (
          <div key={m.key} className="flex items-start gap-4 rounded-card border border-hairline bg-surface px-5 py-4 shadow-card">
            <div className="w-[92px] shrink-0">
              <div className="text-[13px] font-semibold text-ink">{m.label}</div>
              {m.endStrength != null && (
                <div className="mt-0.5 text-[11px] text-ink-subtle">
                  strength <span className="font-semibold text-proof-deep tabular-nums">{m.endStrength}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 border-l border-hairline pl-4">
              <div className="text-[13.5px] text-ink">{m.headline}</div>
            </div>
            {m.gained > 0 && (
              <span className="shrink-0 self-center rounded-full bg-proof-soft px-2.5 py-1 text-[11px] font-bold text-proof-deep">
                +{m.gained}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-8 text-[12px] text-ink-subtle">
        Composed from your strength snapshots, activity and story versions — nothing here is new capture.
      </p>
    </>
  );
}
