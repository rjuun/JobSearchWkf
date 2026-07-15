import type { Metadata } from 'next';
import Link from 'next/link';
import { SCREEN_STEPS, TAILOR_STEPS } from '@/lib/journey';
import { RpShell } from '@/components/roleproof/rp-shell';
import { Frame } from '@/components/layout';

export const metadata: Metadata = { title: 'RoleProof — pipeline' };

// The machinery destination (redesign_2 M4): the gated A → B → C → CI → D process
// every plain-language screen sits on. Rendered from the same journey constants the
// app uses, so the map and the running pipeline can never drift.
type Item = { code: string; label: string; gate?: string };
type Stage = { letter: string; name: string; range: string; items: Item[] };

const STAGES: Stage[] = [
  { letter: 'A', name: 'Acquire', range: 'A1', items: [{ code: 'A1', label: 'Capture & store the job lead (LinkedIn / pasted JD)' }] },
  {
    letter: 'B',
    name: 'Screen',
    range: 'B1–B6',
    items: SCREEN_STEPS.map((s) => ({
      code: s.id,
      label: s.label,
      gate: s.id === 'B1' ? 'Hold if posting ≥ 60 days' : s.id === 'B6' ? 'Promote only if fit ≥ 7' : undefined,
    })),
  },
  {
    letter: 'C',
    name: 'Tailor',
    range: 'C1–C7',
    items: TAILOR_STEPS.map((s) => ({
      code: s.id,
      label: s.label,
      gate: s.id === 'C2' ? 'Human Keep / Maybe / Drop' : undefined,
    })),
  },
  { letter: 'CI', name: 'Improve', range: 'loop', items: [{ code: 'CI', label: 'Coaching + accuracy flags feed back into the graph & prompts' }] },
  { letter: 'D', name: 'Apply', range: 'D', items: [{ code: 'D', label: 'Submit, track & monitor the application' }] },
];

export default function PipelinePage() {
  return (
    <RpShell>
      <Frame className="pt-8 pb-24">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-caution-deep">
          Under the hood · the machinery
        </div>
        <h1 className="mt-1 font-serif text-[44px] leading-none text-ink">The RoleProof pipeline</h1>
        <p className="mt-3 max-w-[74ch] text-sm leading-relaxed text-ink-muted">
          A gated <b className="font-semibold text-ink">A → B → C → CI → D</b> process. Every plain-language screen sits
          on top of this — same steps, same gates, every time. That consistency is what makes the output defensible: a
          score you can explain, and a CV where every line traces to approved evidence.
        </p>

        {/* spine */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {STAGES.map((s) => (
            <span
              key={s.letter}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface py-1.5 pl-1.5 pr-3.5"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-proof font-mono text-[11px] font-bold text-white">
                {s.letter}
              </span>
              <span className="text-[12px] font-bold text-ink">{s.name}</span>
            </span>
          ))}
        </div>

        {/* stage cards */}
        <div className="mt-5 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.letter} className="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
              <div className="flex items-center gap-2.5 border-b border-hairline bg-raised px-4 py-3">
                <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-proof font-mono text-[13px] font-bold text-white">
                  {s.letter}
                </span>
                <div>
                  <div className="text-[13.5px] font-bold text-ink">{s.name}</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.04em] text-ink-subtle">{s.range}</div>
                </div>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-3.5">
                {s.items.map((it) => (
                  <div key={it.code} className="flex items-start gap-2.5">
                    <span className="min-w-[22px] font-mono text-[9px] font-semibold text-proof">{it.code}</span>
                    <div className="flex-1">
                      <div className="text-[12px] leading-snug text-ink">{it.label}</div>
                      {it.gate && (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-caution-ring bg-caution-soft px-2 py-1 text-[9px] font-bold text-caution-deep">
                          ◆ GATE · {it.gate}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* principle band */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-card bg-dark px-6 py-5 text-dark-ink">
          <span className="rounded-md bg-dark-accent/15 px-2.5 py-1.5 font-mono text-[11px] font-bold text-dark-accent">
            non-negotiable
          </span>
          <div className="min-w-[280px] flex-1">
            <div className="text-[15px] font-bold text-dark-ink">Truthfulness over optimisation</div>
            <div className="mt-0.5 text-[12.5px] text-dark-muted">
              Only human-approved evidence becomes CV content. Gaps are shown, never hidden — and the model never
              computes the score, it only judges; the arithmetic is deterministic.
            </div>
          </div>
          <Link
            href="/roleproof"
            className="rounded-[8px] bg-dark-accent px-4 py-2 text-[12px] font-bold text-[#0C2A1F] transition hover:brightness-105"
          >
            Back to the plain view →
          </Link>
        </div>
      </Frame>
    </RpShell>
  );
}
