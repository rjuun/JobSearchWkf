import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardData, getProfile, getCareerGraph, listApplications } from '@/lib/queries';
import { formatDuration } from '@/lib/activation';
import { strengthOf } from '@/lib/career-graph';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { ReturnsPanel } from '@/components/roleproof/returns-panel';
import { Frame } from '@/components/layout';
import { cn } from '@/components/roleproof/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — dashboard' };

// Momentum dashboard (redesign_2): leads with the plain-language view the prototype
// shows — the KPIs, the funnel, and the improvement loop — then keeps the full CI
// telemetry (throughput, initiatives, accuracy flags, LLM cost) under the hood below.
export default async function DashboardPage() {
  const [{ statusRows, totalLeads, avgFit, buckets, ci, tips, usage, activation }, profile, graph, applications] = await Promise.all([
    getDashboardData(),
    getProfile(),
    getCareerGraph(),
    env.nextReturns ? listApplications() : Promise.resolve([]),
  ]);
  const returnItems = applications.map((a) => ({
    id: a.id,
    leadId: a.leadId,
    title: a.title,
    company: a.company,
    status: a.status,
    appliedAt: a.appliedAt ? a.appliedAt.toISOString() : null,
  }));

  const firstName = (profile?.name ?? 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const strength = strengthOf(graph).score;

  const byStatus = new Map<string, number>(statusRows.map((r) => [r.status as string, r.n]));
  const at = (k: string) => byStatus.get(k) ?? 0;
  const shipped = at('applied');
  const inPlay = totalLeads - at('archived') - shipped;
  const FUNNEL = [
    { label: 'Captured', n: at('captured'), cls: 'bg-ink-subtle/45' },
    { label: 'Screened', n: at('screened') + at('hold'), cls: 'bg-proof/45' },
    { label: 'Tailoring', n: at('promoted') + at('tailoring'), cls: 'bg-proof/70' },
    { label: 'Ready', n: at('ready'), cls: 'bg-proof' },
  ];
  const funnelMax = Math.max(1, ...FUNNEL.map((f) => f.n));
  const openTipsTop = tips.filter((t) => !t.resolved).slice(0, 2);
  const STAGE_ORDER: { key: string; label: string }[] = [
    { key: 'captured', label: 'Captured' },
    { key: 'screening', label: 'Screening' },
    { key: 'hold', label: 'Hold' },
    { key: 'screened', label: 'Screened' },
    { key: 'promoted', label: 'Promoted' },
    { key: 'tailoring', label: 'Tailoring' },
    { key: 'ready', label: 'Ready' },
    { key: 'applied', label: 'Applied' },
  ];

  const bucketTotal = Math.max(
    buckets.Proceed + buckets.Borderline + buckets.Hold + buckets['Not recommended'] + buckets.Unscored,
    1
  );
  const BUCKETS: { key: keyof typeof buckets; label: string; cls: string }[] = [
    { key: 'Proceed', label: 'Proceed', cls: 'bg-proof' },
    { key: 'Borderline', label: 'Borderline', cls: 'bg-caution' },
    { key: 'Hold', label: 'Hold', cls: 'bg-drop/70' },
    { key: 'Not recommended', label: 'Not recommended', cls: 'bg-drop' },
    { key: 'Unscored', label: 'Unscored', cls: 'bg-hairline' },
  ];

  const openTips = tips.filter((t) => !t.resolved);

  return (
    <RpShell>
      <Frame className="pt-8 pb-24">
        {/* ── Momentum header ── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {inPlay} {inPlay === 1 ? 'lead' : 'leads'} in play · {shipped} CV{shipped === 1 ? '' : 's'} shipped
            </p>
          </div>
          <Link
            href="/roleproof/capture"
            className="rounded-[9px] bg-proof px-[18px] py-[11px] text-[13px] font-bold text-white shadow-sm transition hover:bg-proof-deep"
          >
            + Capture a lead
          </Link>
        </div>

        {/* ── Momentum KPIs ── */}
        <div className="mt-7 grid grid-cols-2 overflow-hidden rounded-card border border-hairline bg-surface shadow-card sm:grid-cols-4">
          <Stat value={inPlay} label="Active leads" />
          <Stat value={avgFit != null ? avgFit.toFixed(1) : '—'} label="Avg fit" tone="proof" border />
          <Stat value={shipped} label="CVs shipped" border />
          <Stat value={strength} label="Graph strength" tone="proof" border />
        </div>

        {/* ── Returns (B2) — applications sent + outcomes logged ── */}
        <ReturnsPanel items={returnItems} />

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          {/* ── The funnel ── */}
          <Panel title="The funnel">
            <div className="flex flex-col gap-2.5 px-5 py-4">
              {FUNNEL.map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <span className={cn('w-[78px] shrink-0 text-[12px]', f.label === 'Ready' ? 'font-semibold text-proof' : 'text-ink-muted')}>
                    {f.label}
                  </span>
                  <span className="h-[18px] flex-1 overflow-hidden rounded-[4px] bg-raised">
                    <span className={cn('block h-full rounded-[4px]', f.cls)} style={{ width: `${(f.n / funnelMax) * 100}%` }} />
                  </span>
                  <span className="w-5 text-right font-mono text-[12px] tabular-nums text-ink-muted">{f.n}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── Improvement loop (teaser) ── */}
          <Panel title="Improvement loop" badge="your graph is learning">
            <div className="flex flex-col gap-2.5 px-5 py-4">
              {openTipsTop.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No open accuracy flags — your graph is keeping pace.</p>
              ) : (
                openTipsTop.map((t) => (
                  <div key={t.id} className="flex items-start gap-2.5 rounded-[9px] border border-hairline bg-raised px-3 py-2.5">
                    <span className="mt-0.5 rounded bg-caution-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-caution-deep">
                      {t.type ?? 'Flag'}
                    </span>
                    <div className="min-w-0 flex-1 text-[12px] text-ink">{t.observation}</div>
                  </div>
                ))
              )}
              <Link href="/profile/coach" className="mt-1 text-[12px] font-semibold text-proof hover:underline">
                Strengthen your graph →
              </Link>
            </div>
          </Panel>
        </div>

        {/* ── Activation · the two first-win numbers (M5) ── */}
        <div className="mt-6">
          <Panel title="Activation" badge="first-win">
            <div className="grid grid-cols-2 sm:grid-cols-3">
              <Stat value={formatDuration(activation.timeToFirstCvMs)} label="Time to first CV" tone="proof" />
              <Stat value={activation.decisionsBeforeWin ?? '—'} label="Decisions before win" border />
              <Stat value={activation.totalKeeps} label="Evidence kept" border />
            </div>
            <p className="border-t border-hairline px-5 py-3 text-[11.5px] text-ink-subtle">
              {activation.firstCv
                ? 'Measured from the first paste to the first generated CV — the activation question for a new user.'
                : activation.started
                  ? 'Onboarding started — the clock runs until the first CV is generated.'
                  : 'No activation yet — a new user’s paste starts the clock.'}
            </p>
          </Panel>
        </div>

        {/* ── Under the hood · the CI telemetry (kept, just no longer the lead) ── */}
        <div className="mt-10 flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Under the hood</span>
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] text-ink-subtle">
            {usage.runs} runs · {usage.liveCalls} live calls · {fmtTokens(usage.tokens)} tokens
          </span>
        </div>

        {/* ── Usage strip ── */}
        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-card border border-hairline bg-surface shadow-card sm:grid-cols-4">
          <Stat value={usage.runs} label="pipeline runs" />
          <Stat value={usage.calls} label="LLM calls" border />
          <Stat value={usage.liveCalls} label="live calls" tone="proof" border />
          <Stat value={fmtTokens(usage.tokens)} label="tokens used" border />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {/* ── Pipeline status ── */}
          <Panel title="Where leads sit">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-5 py-4 sm:grid-cols-4">
              {STAGE_ORDER.map((s) => (
                <div key={s.key} className="flex flex-col">
                  <span className="font-serif text-[26px] leading-none tabular-nums text-ink">
                    {byStatus.get(s.key) ?? 0}
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── Recommendation spread ── */}
          <Panel title="Fit spread">
            <div className="px-5 py-4">
              <div className="flex h-3 overflow-hidden rounded-full">
                {BUCKETS.map((b) => {
                  const n = buckets[b.key];
                  if (n === 0) return null;
                  return (
                    <span
                      key={b.key}
                      className={b.cls}
                      style={{ width: `${(n / bucketTotal) * 100}%` }}
                      title={`${b.label}: ${n}`}
                    />
                  );
                })}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5">
                {BUCKETS.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span className={cn('h-2.5 w-2.5 rounded-sm', b.cls)} /> {b.label}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{buckets[b.key]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>

        {/* ── CI initiatives ── */}
        <h2 className="mb-3 mt-9 text-sm font-bold text-ink">Improvement initiatives</h2>
        <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
          {ci.length === 0 ? (
            <Empty>No improvement initiatives yet — they accrue as you run and refine the pipeline.</Empty>
          ) : (
            ci.map((i) => {
              const stage = initiativeStage(i.status);
              return (
                <div key={i.id} className="flex items-start gap-4 border-b border-hairline/70 px-5 py-3.5 last:border-0">
                  <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', stage.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{i.title}</span>
                      {i.priority && <Tag tone={i.priority.toLowerCase() === 'high' ? 'caution' : undefined}>{i.priority}</Tag>}
                    </div>
                    {i.body && <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{i.body}</p>}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                      stage.done ? 'bg-proof-soft text-proof-deep' : stage.label === 'Development' ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-muted ring-1 ring-inset ring-hairline'
                    )}
                  >
                    {stage.label}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* ── Accuracy flags (the improve loop) ── */}
        <h2 className="mb-3 mt-9 flex items-center gap-2.5 text-sm font-bold text-ink">
          Accuracy flags
          {openTips.length > 0 && (
            <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-caution-deep">
              {openTips.length} open
            </span>
          )}
        </h2>
        <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
          {tips.length === 0 ? (
            <Empty>No accuracy flags — raise one from any lead workspace when a judgment looks off.</Empty>
          ) : (
            tips.map((t) => (
              <div key={t.id} className="flex items-start gap-4 border-b border-hairline/70 px-5 py-3.5 last:border-0">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', t.resolved ? 'bg-proof' : 'bg-caution')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.type && <Tag>{t.type}</Tag>}
                    <span className={cn('text-sm', t.resolved ? 'text-ink-subtle line-through' : 'text-ink')}>
                      {t.observation}
                    </span>
                  </div>
                  {t.suggestedAction && (
                    <p className="mt-1 text-[13px] text-ink-muted">
                      <span className="font-semibold text-ink-muted">Action: </span>
                      {t.suggestedAction}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    t.resolved ? 'bg-proof-soft text-proof-deep' : 'bg-caution-soft text-caution-deep'
                  )}
                >
                  {t.resolved ? 'resolved' : 'open'}
                </span>
              </div>
            ))
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-subtle">RoleProof · continuous-improvement loop</p>
      </Frame>
    </RpShell>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Stat({
  value,
  label,
  tone,
  border,
}: {
  value: number | string;
  label: string;
  tone?: 'proof';
  border?: boolean;
}) {
  return (
    <div className={cn('px-5 py-4', border && 'sm:border-l sm:border-hairline')}>
      <div className={cn('font-serif text-[34px] leading-none tabular-nums', tone === 'proof' ? 'text-proof' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{label}</div>
    </div>
  );
}

function Panel({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-hairline bg-raised px-5 py-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{title}</span>
        {badge && (
          <span className="rounded-full bg-proof-soft px-2.5 py-0.5 text-[10px] font-semibold text-proof-deep">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'caution' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone === 'caution' ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-muted ring-1 ring-inset ring-hairline'
      )}
    >
      {children}
    </span>
  );
}

// Initiative status is seeded as "N - Label" (e.g. "3 - Delivered"). Parse it into
// a clean label + tone, ignoring the noisier area/time columns from the import.
function initiativeStage(status: string | null): { label: string; dot: string; done: boolean } {
  const raw = (status ?? '').replace(/^\s*\d+\s*-\s*/, '').trim() || 'Idea';
  const s = raw.toLowerCase();
  const done = s.includes('deliver') || s.includes('done');
  const dot = done ? 'bg-proof' : s.includes('develop') || s.includes('progress') ? 'bg-caution' : 'bg-ink-subtle';
  return { label: raw, dot, done };
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm text-ink-muted">{children}</div>;
}
