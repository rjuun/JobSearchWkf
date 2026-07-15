import Link from 'next/link';
import type { Metadata } from 'next';
import { listLeads, requirementCountsByLead, getProfile, thisWeekPicks, sourcingCompass, weeklyTriage } from '@/lib/queries';
import { env } from '@/lib/env';
import { currentOwnerId } from '@/lib/auth';
import { digestSince, getStatementSeenAt, digestHeadline, digestIsSubstantive } from '@/lib/activity';
import { RpShell } from '@/components/roleproof/rp-shell';
import { ThisWeekStrip } from '@/components/roleproof/this-week-strip';
import { WeeklyTriage } from '@/components/roleproof/weekly-triage';
import { TrackedTable } from '@/components/roleproof/tracked-table';
import { SourcingCompass } from '@/components/roleproof/sourcing-compass';
import { StatementReturnBanner } from '@/components/statement-return-banner';
import { Frame } from '@/components/layout';
import {
  RpScore,
  RpVerdictPill,
  RpStagePips,
  RpStagePill,
  rpNextAction,
  cn,
} from '@/components/roleproof/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — your board' };

// Act I · 1C — "the board: momentum across many leads", in the plain-language voice.
export default async function RoleProofBoard() {
  const [leads, reqCounts, profile, weekPicks, sources, triage] = await Promise.all([
    listLeads(),
    requirementCountsByLead(),
    getProfile(),
    // The A3 strip only when the fuller R5 triage isn't superseding it.
    env.nextThisWeek && !env.nextTriage ? thisWeekPicks() : Promise.resolve([]),
    env.nextSourcingCompass ? sourcingCompass() : Promise.resolve([]),
    env.nextTriage ? weeklyTriage() : Promise.resolve(null),
  ]);

  // R3 · the Statement's re-entry ritual — roll up what accrued since the owner last
  // looked at their Statement, so the board greets a returning user with momentum.
  let returnDigest = null as Awaited<ReturnType<typeof digestSince>> | null;
  if (env.nextStatement) {
    const owner = await currentOwnerId();
    returnDigest = await digestSince(owner, await getStatementSeenAt(owner));
  }

  const active = leads.filter((l) => l.status !== 'archived');
  const scored = active.filter((l) => l.overallFitScore != null);
  const ready = active.filter((l) => l.status === 'ready').length;
  const proceed = scored.filter((l) => (l.overallFitScore ?? 0) >= 7).length;
  const borderline = scored.filter(
    (l) => (l.overallFitScore ?? 0) >= 5.5 && (l.overallFitScore ?? 0) < 7
  ).length;
  const hold = scored.filter((l) => (l.overallFitScore ?? 0) < 5.5).length;
  const spreadTotal = Math.max(proceed + borderline + hold, 1);

  // "Needs you" — the decisions waiting on the human, prioritised, capped at 4.
  type Focus = { id: string; glyph: string; tone: 'proof' | 'caution' | 'drop'; title: string; sub: string; cta: string };
  const focus: Focus[] = [];
  const seen = new Set<string>();
  const add = (f: Focus) => {
    if (focus.length < 4 && !seen.has(f.id)) {
      focus.push(f);
      seen.add(f.id);
    }
  };
  for (const l of active)
    if (l.status === 'tailoring' || l.status === 'promoted')
      add({ id: l.id, glyph: '1', tone: 'proof', title: `Approve evidence · ${l.title}`, sub: 'Decide what genuinely belongs — only “Keep” reaches the CV.', cta: 'Resume triage' });
  for (const l of active)
    if (l.status === 'ready')
      add({ id: l.id, glyph: '↓', tone: 'proof', title: `Send · ${l.title}`, sub: 'CV is tailored and within the 2-page budget.', cta: 'Download' });
  for (const l of active)
    if (l.status === 'screened' && (l.overallFitScore ?? 0) >= 5.5)
      add({ id: l.id, glyph: '2', tone: 'caution', title: `Promote · ${l.title}`, sub: `Scored ${(l.overallFitScore ?? 0).toFixed(1)} — clears the bar for tailoring.`, cta: 'Promote' });
  for (const l of active)
    if (l.status === 'hold')
      add({ id: l.id, glyph: '!', tone: 'drop', title: `Decide · ${l.title}`, sub: 'Held — the posting looks old. Screen anyway, or set aside.', cta: 'Review' });
  for (const l of active)
    if (l.status === 'captured')
      add({ id: l.id, glyph: '•', tone: 'caution', title: `Screen · ${l.title}`, sub: 'Captured and ready — is it worth your time?', cta: 'Open' });

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';
  const dateLabel = `${now.toLocaleDateString('en-GB', { weekday: 'long' })} · ${now.getDate()} ${now.toLocaleDateString('en-GB', { month: 'long' })}`;

  return (
    <RpShell>
      <Frame className="pt-8 pb-24">
        {/* ── R3 · re-entry banner — only when the return is substantive (not a lone event) ── */}
        {returnDigest && digestIsSubstantive(returnDigest) && (
          <StatementReturnBanner newCount={returnDigest.newCount} headline={digestHeadline(returnDigest.totals)} />
        )}

        {/* ── Header ── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {dateLabel}
            </div>
            <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {active.length} {active.length === 1 ? 'role' : 'roles'} in play ·{' '}
              {ready === 0 ? 'no CVs' : `${ready} CV${ready === 1 ? '' : 's'}`} ready to send
            </p>
          </div>
          <Link
            href="/roleproof/capture"
            className="rounded-[9px] bg-proof px-[18px] py-[11px] text-[13px] font-bold text-white shadow-[0_2px_10px_-3px_rgba(19,122,91,.5)] transition hover:bg-proof-deep"
          >
            + Capture a lead
          </Link>
        </div>

        {/* ── Momentum strip ── */}
        <div className="mt-7 grid grid-cols-2 overflow-hidden rounded-card border border-hairline bg-surface shadow-card sm:grid-cols-4">
          <Stat value={scored.length} label="screened" />
          <Stat value={ready} label="CV ready" tone="proof" />
          <Stat value={active.length} label="in play" border />
          <div className="px-5 py-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
              Fit spread
            </div>
            <div className="flex h-[30px] items-end gap-1.5">
              <SpreadBar n={proceed} total={spreadTotal} cls="bg-proof" />
              <SpreadBar n={borderline} total={spreadTotal} cls="bg-caution" />
              <SpreadBar n={hold} total={spreadTotal} cls="bg-drop" />
            </div>
            <div className="mt-1.5 flex gap-3 text-[10px] text-ink-subtle">
              <span>{proceed} proceed</span>
              <span>{borderline} borderline</span>
              <span>{hold} hold</span>
            </div>
          </div>
        </div>

        {/* ── This week — the full R5 triage (judges the whole queue), or the A3 strip ── */}
        {env.nextTriage && triage ? <WeeklyTriage triage={triage} /> : <ThisWeekStrip picks={weekPicks} />}

        {/* ── Needs you ── */}
        {focus.length > 0 && (
          <>
            <div className="mt-9 flex items-center gap-2.5">
              <h2 className="text-sm font-bold text-ink">Needs you</h2>
              <span className="rounded-full bg-proof-soft px-2 py-0.5 text-[11px] font-semibold text-proof-deep">
                {focus.length}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {focus.map((f) => (
                <Link
                  key={`${f.id}-${f.glyph}`}
                  href={`/roleproof/leads/${f.id}`}
                  className="flex items-center gap-4 rounded-card border border-hairline bg-surface px-[18px] py-4 shadow-card transition hover:border-proof-ring hover:shadow-[0_2px_12px_-4px_rgba(19,122,91,.25)]"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[13px] font-bold',
                      f.tone === 'proof' && 'bg-proof-soft text-proof-deep',
                      f.tone === 'caution' && 'bg-caution-soft text-caution-deep',
                      f.tone === 'drop' && 'bg-drop-soft text-drop-deep'
                    )}
                  >
                    {f.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-ink">{f.title}</div>
                    <div className="mt-0.5 truncate text-[13px] text-ink-muted">{f.sub}</div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-proof">
                    {f.cta} →
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* ── All leads — the raw table stays; TrackedTable measures free-roam (R5) ── */}
        <h2 className="mb-3 mt-9 text-sm font-bold text-ink">All leads</h2>
        <TrackedTable enabled={env.nextTriage}>
        <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
          {leads.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="font-serif text-2xl text-ink">No leads yet</div>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
                Capture a job posting to start the screening pipeline.
              </p>
              <Link
                href="/roleproof/capture"
                className="mt-5 inline-flex rounded-[9px] bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep"
              >
                Capture a lead
              </Link>
            </div>
          ) : (
            leads.map((l) => {
              const next = rpNextAction(l.status, l.overallFitScore);
              const faded = l.overallFitScore != null && l.overallFitScore < 5.5;
              return (
                <Link
                  key={l.id}
                  href={`/roleproof/leads/${l.id}`}
                  className={cn(
                    'flex items-center gap-4 border-b border-hairline/70 px-5 py-3.5 transition last:border-0 hover:bg-raised/60',
                    faded && 'opacity-70'
                  )}
                >
                  <RpScore score={l.overallFitScore} className="w-12 shrink-0 text-[30px]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{l.title}</div>
                    <div className="truncate text-xs text-ink-subtle">
                      {[l.company, l.city].filter(Boolean).join(' · ') || '—'}
                      {reqCounts.get(l.id) ? ` · ${reqCounts.get(l.id)} must-haves` : ''}
                    </div>
                  </div>
                  <div className="hidden sm:block">
                    {l.overallFitScore != null ? (
                      <RpVerdictPill score={l.overallFitScore} />
                    ) : (
                      <RpStagePill status={l.status} />
                    )}
                  </div>
                  <RpStagePips status={l.status} className="hidden md:flex" />
                  <span
                    className={cn(
                      'w-[84px] shrink-0 whitespace-nowrap text-right text-[12px] font-bold',
                      next.actionable ? 'text-proof' : 'text-ink-subtle'
                    )}
                  >
                    {next.label}
                    {next.actionable ? ' →' : ''}
                  </span>
                </Link>
              );
            })
          )}
        </div>
        </TrackedTable>

        {/* ── Sourcing compass (B4) — ranks capture channels by fit produced ── */}
        <SourcingCompass rows={sources} />

        <p className="mt-6 text-center text-xs text-ink-subtle">RoleProof · your momentum board</p>
      </Frame>
    </RpShell>
  );
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
      <div
        className={cn(
          'font-serif text-[38px] leading-none tabular-nums',
          tone === 'proof' ? 'text-proof' : 'text-ink'
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
        {label}
      </div>
    </div>
  );
}

function SpreadBar({ n, total, cls }: { n: number; total: number; cls: string }) {
  // Min visible height so empty bands still read as a band.
  const pct = Math.max(Math.round((n / total) * 100), n > 0 ? 22 : 10);
  return (
    <span className="flex flex-1 items-end" title={`${n}`}>
      <span className={cn('w-full rounded-[2px]', n > 0 ? cls : 'bg-hairline')} style={{ height: `${pct}%` }} />
    </span>
  );
}
