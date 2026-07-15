import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentOwnerId } from '@/lib/auth';
import { env } from '@/lib/env';
import { listActivity, summarizeStatement, markStatementSeen } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';
import { RpShell } from '@/components/roleproof/rp-shell';
import { Frame } from '@/components/layout';
import { StatementTabs } from '@/components/roleproof/statement-tabs';
import { hasLedgerSubstance } from '@/app/actions/ledger';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — your statement' };

// B1 · the Statement — a read-only re-entry ritual. It re-projects the activity log
// (evidence kept, targets flagged, roles screened, CVs made, applications sent) into
// "here's what you did," so returning to the search feels like resuming momentum
// rather than facing a cold queue. A monthly email would drive the return; here it's
// the in-app surface. Reaction signal: statement · open.
const KIND_META: Record<string, { glyph: string; tone: string }> = {
  evidence_kept: { glyph: '✓', tone: 'text-proof-deep' },
  coach_approved: { glyph: '✦', tone: 'text-proof-deep' },
  target_flagged: { glyph: '⌖', tone: 'text-caution-deep' },
  screening: { glyph: '◎', tone: 'text-ink-muted' },
  cv_generated: { glyph: '↓', tone: 'text-proof-deep' },
  story_generated: { glyph: '✍', tone: 'text-proof-deep' },
  applied: { glyph: '→', tone: 'text-proof-deep' },
  outcome: { glyph: '★', tone: 'text-caution-deep' },
};

export default async function StatementPage() {
  if (!env.nextStatement) redirect('/roleproof');
  const owner = await currentOwnerId();
  const events = await listActivity(owner, 30);
  void recordUxEvent(owner, 'statement', 'open');
  // R3 · viewing the Statement is the re-entry — reset the "since you were last here"
  // marker so the board banner clears until new activity accrues. Awaited (not fire-and-
  // forget) so the marker is committed before render — the banner can't survive a quick
  // back-navigation to the board.
  await markStatementSeen(owner);
  const totals = summarizeStatement(events);
  // R6 self-gate — only offer the Ledger tab once it has real accumulation to show.
  const showLedgerTab = env.nextLedger && (await hasLedgerSubstance());

  const STATS: { label: string; value: number }[] = [
    { label: 'evidence kept', value: totals.evidenceKept },
    { label: 'coach answers', value: totals.coachApproved },
    { label: 'targets flagged', value: totals.targetsFlagged },
    { label: 'roles screened', value: totals.screened },
    { label: 'CVs tailored', value: totals.cvsGenerated },
    { label: 'applications', value: totals.applied },
  ];

  // Group the timeline by day for a scannable recap.
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const key = e.at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }

  return (
    <RpShell>
      <Frame className="pt-8 pb-24">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Last 30 days</div>
        <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">Your statement</h1>
        <p className="mt-2 max-w-[60ch] text-sm text-ink-muted">
          A quiet record of the work you put in — the moves that compounded your Career Graph and moved roles forward.
          Not a to-do list; a reason to come back.
        </p>
        {showLedgerTab && <StatementTabs active="statement" showLedger />}

        {totals.total === 0 ? (
          <div className="mt-8 rounded-card border border-hairline bg-surface p-10 text-center shadow-card">
            <div className="font-serif text-2xl text-ink">Nothing logged yet</div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
              Keep evidence, flag a target, or screen a role and it lands here — your statement builds itself as you work.
            </p>
            <Link
              href="/roleproof"
              className="mt-5 inline-flex rounded-[9px] bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep"
            >
              Go to your board
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-7 grid grid-cols-3 overflow-hidden rounded-card border border-hairline bg-surface shadow-card sm:grid-cols-6">
              {STATS.map((s, i) => (
                <div key={s.label} className={i > 0 ? 'border-l border-hairline px-4 py-4' : 'px-4 py-4'}>
                  <div className="font-serif text-[30px] leading-none tabular-nums text-ink">{s.value}</div>
                  <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{s.label}</div>
                </div>
              ))}
            </div>

            <h2 className="mb-3 mt-9 text-sm font-bold text-ink">Timeline</h2>
            <div className="flex flex-col gap-6">
              {[...byDay.entries()].map(([day, rows]) => (
                <div key={day}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{day}</div>
                  <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-card">
                    {rows.map((e) => {
                      const meta = KIND_META[e.kind] ?? { glyph: '•', tone: 'text-ink-muted' };
                      const body = (
                        <div className="flex items-center gap-3 border-b border-hairline/70 px-5 py-3 last:border-0">
                          <span className={`shrink-0 text-[15px] ${meta.tone}`}>{meta.glyph}</span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                            {e.summary ?? e.kind.replace(/_/g, ' ')}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                            {e.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                      return e.leadId ? (
                        <Link key={e.id} href={`/roleproof/leads/${e.leadId}`} className="block transition hover:bg-raised/60">
                          {body}
                        </Link>
                      ) : (
                        <div key={e.id}>{body}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-ink-subtle">RoleProof · your statement · a monthly recap, in-app for now</p>
      </Frame>
    </RpShell>
  );
}
