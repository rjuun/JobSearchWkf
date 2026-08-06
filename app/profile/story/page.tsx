import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { Card, Badge, Button, Input, Select, cn } from '@/components/ui';
import { env } from '@/lib/env';
import { currentOwnerId } from '@/lib/auth';
import { latestStory, storyVersionCount } from '@/lib/story';
import { getCareerGraphFor, listTips } from '@/lib/queries';
import { strengthOf, type StrengthComponent } from '@/lib/career-graph';
import { StoryView, type StoryData } from '@/components/roleproof/story-view';
import { addTipAction, resolveTipAction } from '@/app/actions/tips';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'RoleProof — your story' };

const TIP_TYPES = ['Feedback Loop', 'Profile Update', 'Data Capture', 'Process Refinement'];

// R7 · "make room" — the structured-interview Groups below are the proposed sequence
// for a future guided-interview flow (see the recycled CI "Onboarding — Consultant-
// Guided Interview Agent") that collects the evidence behind the Career Graph the way
// a human career consultant does today (BDO Work Sheets New Placement method). Static
// content for now — not wired to any interview UI yet.
const INTERVIEW_GROUPS: { n: number; title: string; blurb: string; covers: string[] }[] = [
  {
    n: 1,
    title: 'Foundations & direction',
    blurb: 'The working agreement and the values/criteria later evidence gets checked against.',
    covers: ['Expectations & wishes', 'Your ideal scenario', 'Your definition of success', 'Values & motives', 'Likes & dislikes'],
  },
  {
    n: 2,
    title: 'Key achievements',
    blurb: 'A keyword shortlist of candidate success stories, before they get expanded into full STARs.',
    covers: ['Identify your achievements (13 prompts)'],
  },
  {
    n: 3,
    title: 'STAR collection I',
    blurb: 'Deep evidence capture — Situation/Task/Action/Result plus the skills, competencies and attributes behind each story.',
    covers: ['The STAR method', 'STAR #1–4'],
  },
  {
    n: 4,
    title: 'STAR collection II',
    blurb: 'A second pass — eight STARs is too much ground for one session.',
    covers: ['STAR #5–8'],
  },
  {
    n: 5,
    title: 'Competencies & self-assessment',
    blurb: 'Feeds the Competence/Attribute/Skill nodes directly.',
    covers: ['Self-assessment / external assessment', 'Competencies (professional, methodical, social, leadership)'],
  },
  {
    n: 6,
    title: 'Industry & positioning',
    blurb: 'Target-role criteria — feeds job matching rather than the graph itself.',
    covers: ['Industry affinity', 'Personal career vision', 'Overview of professional objectives', 'Ideal position'],
  },
];

export default async function StoryPage() {
  if (!env.nextStory) redirect('/profile');
  const owner = await currentOwnerId();
  const [v, versions, g, tips] = await Promise.all([
    latestStory(owner),
    storyVersionCount(owner),
    getCareerGraphFor(owner),
    listTips(),
  ]);
  const story: StoryData = v
    ? {
        throughLine: v.throughLine,
        coverLetter: v.coverLetter,
        linkedinAbout: v.linkedinAbout,
        evidenceCount: v.evidenceCount,
        createdAt: v.createdAt ? v.createdAt.toISOString() : null,
        versions,
      }
    : null;
  const actionsByStar = countBy(g.actions, (a) => a.starRef);
  const resultsByStar = countBy(g.results, (r) => r.starRef);
  const openTips = tips.filter((t) => !t.resolved).length;
  // Graph strength + To strengthen — moved here from /profile (the Career Graph /
  // Meter view) so that view stays focused on the node graph itself; the compact
  // Positions/Stories/Quantified/ATS Skills counts at the top of that view already
  // cover the at-a-glance need, and this fuller breakdown reads better as part of
  // "am I ready to generate my story" than as node-graph chrome.
  const { score, ceiling, headroom, label, components, signals: sig, gaps } = strengthOf(g);
  const strengthPill =
    score >= 73 ? 'bg-proof-soft text-proof-deep' : score >= 50 ? 'bg-caution-soft text-caution-deep' : 'bg-raised text-ink-muted';

  return (
    <AppShell>
      <Link href="/profile" className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink">
        <span aria-hidden>←</span> Back to your Career Graph
      </Link>
      <div className="mb-2 mt-3 flex items-center gap-2">
        <Link href="/profile" className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink">
          Strength meter
        </Link>
        <span aria-current="page" className="rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-ink">
          Your story
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your story</h1>
      <p className="mt-1 max-w-[62ch] text-sm text-ink-muted">
        The through-line that connects your roles — and ready-to-adapt cover-letter and LinkedIn drafts, all built from the
        evidence you’ve approved.
      </p>

      {/* ── Structured interviews — the sequence that builds the Career Graph's evidence,
             the way a consultant-guided session does today (see BDO Work Sheets New
             Placement). Static outline for now; not wired to a live interview flow. ── */}
      <Card className="mt-6 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Structured interviews</h2>
            <p className="text-[11px] text-ink-subtle">The proposed sequence of one-hour sessions that build your Career Graph's evidence.</p>
          </div>
        </div>
        <ol className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {INTERVIEW_GROUPS.map((grp) => (
            <li key={grp.n} className="rounded-field border border-hairline bg-raised p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-[20px] leading-none text-proof tabular-nums">{grp.n}</span>
                <span className="text-sm font-semibold text-ink">{grp.title}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{grp.blurb}</p>
              <p className="mt-1.5 text-[11px] text-ink-subtle">{grp.covers.join(' · ')}</p>
            </li>
          ))}
        </ol>
      </Card>

      <StoryView story={story} />

      {/* ── Identity ── */}
      <SectionCard title="Identity" count={g.profile ? 1 : 0} href="/profile/identity" className="mt-8">
        {g.profile ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-ink">{g.profile.name}</span>
            {g.profile.headline && <span className="text-ink-muted">{g.profile.headline}</span>}
            {g.profile.location && <span className="text-ink-subtle">{g.profile.location}</span>}
            {g.profile.email && <span className="ref text-ink-subtle">{g.profile.email}</span>}
          </div>
        ) : (
          <p className="text-sm text-ink-subtle">No identity yet — add your name and headline.</p>
        )}
      </SectionCard>

      {/* ── Strength hero · the proof anchor (redesign_2: the prototype's light card —
             proof-green serif score, band pill, and the evidence tiles it's built from).
             Moved here from /profile (R7 · "make room" follow-up). ── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-5 rounded-card border border-hairline bg-surface p-6 shadow-card sm:p-7">
        <div className="min-w-[200px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            Graph strength
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-serif text-[64px] leading-[0.9] text-proof tabular-nums">{score}</span>
            <span className="text-[15px] text-ink-subtle">/ 100</span>
          </div>
          <div className={cn('mt-2 inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold', strengthPill)}>
            {label}
          </div>
          {/* Progress toward the current ceiling, with the rest of the 0–100 track shown
              as (locked) headroom — so the meter reads as "room to grow", never "done". */}
          <div className="relative mt-3 h-1.5 w-[220px] max-w-full overflow-hidden rounded-full bg-raised">
            <div className="absolute inset-y-0 left-0 rounded-full bg-proof-soft" style={{ width: `${ceiling}%` }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-proof transition-[width] duration-700 ease-out-soft"
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-ink-subtle">
            {ceiling < 100
              ? 'Flag a role you’re targeting to unlock 25 points of headroom'
              : `${headroom} points of headroom to grow`}
          </div>
          <Link href="/profile/coach" className="mt-3 inline-block text-[12px] font-semibold text-proof hover:underline">
            ↑ Grow it with your coach →
          </Link>
        </div>
        {/* The strength breakdown — the five dimensions the meter is built from (M1). */}
        <div className="flex-1">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {components.map((c) => (
              <ComponentBar key={c.key} c={c} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            <StatTile label="Positions" value={sig.positions} />
            <StatTile label="Stories" value={sig.stars} />
            <StatTile label="Quantified" value={sig.quantifiedResults} accent />
            <StatTile label="Skills" value={sig.skills} />
          </div>
        </div>
      </div>

      {/* To strengthen — light + actionable, sitting just beneath the hero */}
      {gaps.length > 0 && (
        <div className="mt-3 rounded-card border border-caution-ring bg-caution-soft px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-caution-deep">
              To strengthen
            </div>
            <Link href="/profile/coach" className="text-[11px] font-semibold text-proof-deep hover:underline">
              Coach me →
            </Link>
          </div>
          <ul className="mt-1.5 grid gap-x-5 gap-y-1 sm:grid-cols-2">
            {gaps.slice(0, 4).map((gp, i) => (
              <li key={i}>
                <Link href="/profile/coach" className="flex gap-2 text-[13px] text-ink-muted transition hover:text-ink">
                  <span aria-hidden className="text-caution">→</span>
                  {gp}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Evidence sections ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Positions" count={g.positions.length} href="/profile/positions">
          <Peek
            items={g.positions.map((p) => ({
              key: p.id,
              main: p.title ?? '—',
              sub: [p.company, [p.startDate, p.endDate].filter(Boolean).join(' – ')].filter(Boolean).join(' · '),
              code: p.refCode,
            }))}
          />
        </SectionCard>

        <SectionCard title="STAR stories" count={g.stars.length} href="/profile/stars">
          <Peek
            items={g.stars.map((s) => ({
              key: s.id,
              main: s.title ?? '—',
              sub: `${actionsByStar.get(s.refCode ?? '') ?? 0} actions · ${resultsByStar.get(s.refCode ?? '') ?? 0} results`,
              code: s.refCode,
            }))}
          />
        </SectionCard>

        <SectionCard title="Skills" count={g.skills.length} href="/profile/skills">
          <div className="flex flex-wrap gap-1.5">
            {g.skills.slice(0, 12).map((s) => (
              <Badge key={s.id} tone={(s.atsKeywordVariants ?? []).length > 0 ? 'neutral' : 'amber'}>
                {s.skill}
              </Badge>
            ))}
            {g.skills.length > 12 && <span className="text-xs text-ink-subtle">+{g.skills.length - 12} more</span>}
            {g.skills.length === 0 && <span className="text-sm text-ink-subtle">No skills yet.</span>}
          </div>
        </SectionCard>

        <SectionCard title="Responsibilities" count={g.responsibilities.length} href="/profile/responsibilities">
          <Peek items={g.responsibilities.map((r) => ({ key: r.id, main: r.text ?? '—', sub: '', code: r.refCode }))} />
        </SectionCard>

        <SectionCard title="Education" count={g.education.length} href="/profile/education">
          <Peek
            items={g.education.map((e) => ({
              key: e.id,
              main: e.qualification ?? '—',
              sub: [e.institution, e.year].filter(Boolean).join(' · '),
              code: e.refCode,
            }))}
          />
        </SectionCard>

        <SectionCard title="Languages" count={g.languages.length} href="/profile/languages">
          <div className="flex flex-wrap gap-1.5">
            {g.languages.map((l) => (
              <Badge key={l.id} tone="neutral">
                {l.language}
                {l.cefrLevel ? ` · ${l.cefrLevel}` : ''}
              </Badge>
            ))}
            {g.languages.length === 0 && <span className="text-sm text-ink-subtle">No languages yet.</span>}
          </div>
        </SectionCard>

        <SectionCard title="Bullet bank" count={g.bullets.length} href="/profile/bullets" className="lg:col-span-2">
          <Peek items={g.bullets.map((b) => ({ key: b.id, main: b.text ?? '—', sub: '', code: b.refCode }))} max={3} />
        </SectionCard>
      </div>

      {/* ── Improve (the loop — folded in from the old dashboard) ── */}
      <Card className="mt-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Improve</h2>
            <p className="text-[11px] text-ink-subtle">
              Notes to sharpen your graph and the pipeline over time
              {openTips ? ` · ${openTips} open` : ''}.
            </p>
          </div>
        </div>
        <form action={addTipAction} className="mt-3 flex flex-wrap gap-2">
          <div className="w-44 shrink-0">
            <Select name="type" className="text-xs" aria-label="Note type">
              {TIP_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <Input
            name="observation"
            required
            placeholder="What could be better?"
            className="min-w-[200px] flex-1"
            aria-label="Observation"
          />
          <Button type="submit">Add</Button>
        </form>
        <ul className="mt-4 space-y-2">
          {tips.length === 0 && (
            <li className="py-3 text-center text-sm text-ink-subtle">
              No notes yet — capture one above, or flag one from a lead.
            </li>
          )}
          {tips.map((t) => (
            <li
              key={t.id}
              className={cn(
                'rounded-field border px-3 py-2 text-sm',
                t.resolved ? 'border-hairline bg-raised' : 'border-hairline bg-surface'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-proof-deep">{t.type}</span>
                  {t.whereApplies && <span className="text-xs text-ink-subtle"> · {t.whereApplies}</span>}
                  <div className={cn('text-ink', t.resolved && 'text-ink-subtle line-through')}>{t.observation}</div>
                  {t.suggestedAction && <div className="text-xs text-ink-muted">→ {t.suggestedAction}</div>}
                </div>
                {!t.resolved && (
                  <form action={resolveTipAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-subtle transition hover:bg-raised hover:text-ink">
                      Resolve
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}

// ── pieces (moved from app/profile/page.tsx during R7 "make room") ─────────────────

function SectionCard({
  title,
  count,
  href,
  className,
  children,
}: {
  title: string;
  count: number;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-hairline tabular-nums">
            {count}
          </span>
        </div>
        <Link href={href} className="text-xs font-medium text-proof-deep transition hover:text-proof">
          Manage →
        </Link>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

function Peek({
  items,
  max = 4,
}: {
  items: { key: string; main: string; sub?: string; code: string | null }[];
  max?: number;
}) {
  if (items.length === 0) return <p className="text-sm text-ink-subtle">Nothing here yet.</p>;
  return (
    <ul className="space-y-2">
      {items.slice(0, max).map((it) => (
        <li key={it.key} className="flex items-start gap-2 text-sm">
          {it.code && <span className="ref mt-0.5 shrink-0 text-ink-subtle">{it.code}</span>}
          <span className="min-w-0">
            <span className="line-clamp-1 font-medium text-ink">{it.main}</span>
            {it.sub && <span className="line-clamp-1 text-xs text-ink-subtle">{it.sub}</span>}
          </span>
        </li>
      ))}
      {items.length > max && <li className="text-xs text-ink-subtle">+{items.length - max} more</li>}
    </ul>
  );
}

// One dimension of the strength meter — label, a filled bar toward its max, and points.
// (Moved from app/profile/page.tsx alongside the Graph strength hero.)
function ComponentBar({ c }: { c: StrengthComponent }) {
  const filled = c.max > 0 ? Math.round((c.earned / c.max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{c.label}</span>
        <span className="text-[11px] tabular-nums text-ink-subtle">
          {c.earned}
          <span className="text-ink-subtle/70">/{c.max}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out-soft', c.locked ? 'bg-caution' : 'bg-proof')}
          style={{ width: `${filled}%` }}
        />
      </div>
      {c.locked && <div className="mt-0.5 text-[10.5px] text-caution-deep">{c.locked}</div>}
    </div>
  );
}

// A warm evidence tile in the light strength hero — serif count + label.
function StatTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-[9px] border border-hairline bg-raised p-3.5">
      <div className={cn('font-serif text-[30px] leading-none tabular-nums', accent ? 'text-proof' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-ink-subtle">{label}</div>
    </div>
  );
}

function countBy<T>(rows: T[], key: (r: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? '';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
