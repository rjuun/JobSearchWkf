import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ButtonLink, cn } from '@/components/ui';
import { getCareerGraphFor, targetCoverageMatrix } from '@/lib/queries';
import { strengthOf } from '@/lib/career-graph';
import { currentOwnerId } from '@/lib/auth';
import { listActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';
import { env } from '@/lib/env';
import { ProofLinkControl } from '@/components/roleproof/proof-link-control';
import { CaptureTokenControl } from '@/components/roleproof/capture-token-control';
import { AssembledGraph } from '@/components/roleproof/assembled-graph';
import { CareerGraphView } from '@/components/roleproof/career-graph-view';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { from?: string; role?: string; view?: string };
}) {
  const owner = await currentOwnerId();
  const g = await getCareerGraphFor(owner);
  // ceiling/headroom/components/gaps only fed the Graph strength + To strengthen
  // blocks, which moved to /profile/story (see StoryPage) — score/label/signals
  // still drive the onboarding hero and the assembled view below.
  const { score, label, signals: sig } = strengthOf(g);

  // R7 · 3a — the assembled (matrix-first) face is the default when NEXT_GRAPH_ASSEMBLED
  // is on. It's only coherent while the Coverage Matrix itself is live, so retiring the
  // matrix (NEXT_COVERAGE_MATRIX=0) retires this face too — degrading to the strength-meter
  // view rather than resurrecting the matrix as the profile's primary surface. The meter
  // view stays one click away at ?view=meter. Both emit graph_page.
  const canAssemble = env.nextGraphAssembled && env.nextCoverageMatrix;
  const assembled = canAssemble && searchParams.view !== 'meter';
  const backTo0 = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : null;
  if (assembled) {
    const [matrix, activity] = await Promise.all([targetCoverageMatrix(), listActivity(owner, 30)]);
    void recordUxEvent(owner, 'graph_page', 'open', { meta: { view: 'assembled' } });
    return (
      <AppShell>
        {backTo0 && (
          <Link
            href={backTo0}
            className="mb-3 inline-flex items-center gap-2 rounded-full bg-proof-soft px-3.5 py-1.5 text-[13px] font-semibold text-proof-deep ring-1 ring-inset ring-proof-ring transition hover:opacity-90"
          >
            <span aria-hidden>←</span> Back to {searchParams.role || 'the lead'} · strengthen, then return
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">Your evidence</div>
            <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">Career Graph</h1>
            <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
              Your coverage against the roles you&rsquo;re chasing, backed by a living record of the work you put in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ViewToggle active="assembled" />
            <ButtonLink href="/profile/coach" variant="secondary">Strengthen</ButtonLink>
            <ButtonLink href="/profile/onboarding" leftIcon={<span aria-hidden>✦</span>}>
              {sig.positions > 0 || sig.stars > 0 ? 'Import more' : 'Build with AI'}
            </ButtonLink>
          </div>
        </div>
        {env.nextProofLink && <ProofLinkControl enabled={g.profile?.publicEnabled ?? false} token={g.profile?.publicToken ?? null} />}
        <CaptureTokenControl />
        <AssembledGraph score={score} label={label} matrix={matrix} activity={activity} />
      </AppShell>
    );
  }
  void recordUxEvent(owner, 'graph_page', 'open', { meta: { view: 'meter' } });

  // Onboarding folds into the graph story: lead with "build" when the graph is thin,
  // and offer "import more" once it's established.
  const hasGraph = sig.positions > 0 || sig.stars > 0;
  const showOnboardingHero = !hasGraph || score < 45;
  const buildLabel = hasGraph ? 'Import more' : 'Build with AI';

  // Enrich-on-gap loop: when the user arrived from a lead's gap, offer a way back.
  const backTo = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : null;
  const backRole = searchParams.role || 'the lead';

  return (
    <AppShell>
      {backTo && (
        <Link
          href={backTo}
          className="mb-3 inline-flex items-center gap-2 rounded-full bg-proof-soft px-3.5 py-1.5 text-[13px] font-semibold text-proof-deep ring-1 ring-inset ring-proof-ring transition hover:opacity-90"
        >
          <span aria-hidden>←</span> Back to {backRole} · strengthen, then return
        </Link>
      )}

      {/* ── Editorial header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Your evidence
          </div>
          <h1 className="mt-1 font-serif text-[40px] leading-none text-ink">Career Graph</h1>
          <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">
            The evidence the whole pipeline draws from. The richer and more honest it is, the better
            your matches and CVs — and it’s yours to grow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canAssemble && <ViewToggle active="meter" />}
          {env.nextStory && (
            <ButtonLink href="/profile/story" variant="secondary">
              Your story
            </ButtonLink>
          )}
          {env.nextCoverageMatrix && (
            <ButtonLink href="/profile/coverage" variant="secondary">
              Coverage matrix
            </ButtonLink>
          )}
          <ButtonLink href="/profile/coach" variant="secondary">
            Strengthen
          </ButtonLink>
          <ButtonLink href="/profile/onboarding" leftIcon={<span aria-hidden>✦</span>}>
            {buildLabel}
          </ButtonLink>
        </div>
      </div>

      {env.nextProofLink && <ProofLinkControl enabled={g.profile?.publicEnabled ?? false} token={g.profile?.publicToken ?? null} />}
      <CaptureTokenControl />

      {/* ── Onboarding front door (the "BUILD" stage, surfaced by graph state) ── */}
      {showOnboardingHero && (
        <div className="mt-5 overflow-hidden rounded-card border border-proof-ring bg-gradient-to-br from-proof-soft to-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="max-w-[48ch]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-proof-deep">
                Start here
              </div>
              <h2 className="mt-1 font-serif text-[26px] leading-snug text-ink">
                Build your Career Graph in minutes
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
                Paste a CV or LinkedIn export — the AI drafts your positions, stories, skills and
                results. You keep what’s true; nothing is saved until you say so. Then screen a role
                and tailor a CV straight from it.
              </p>
            </div>
            <ButtonLink href="/profile/onboarding" size="lg" leftIcon={<span aria-hidden>✦</span>}>
              Build with AI
            </ButtonLink>
          </div>
        </div>
      )}

      {/* ── Career Graph · the live evidence map (R7). Everything below it that used to
             live here — Identity, the per-section cards, and Improve — now lives on
             /profile/story, reached via the "Your story" link above. ── */}
      <CareerGraphView graph={g} />

    </AppShell>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

// R7 · 3a · toggle between the assembled (matrix-first) face and the strength-meter lens.
function ViewToggle({ active }: { active: 'assembled' | 'meter' }) {
  const pill = (href: string, text: string, key: 'assembled' | 'meter') => (
    <Link
      href={href}
      className={cn(
        'rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
        active === key ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-raised'
      )}
    >
      {text}
    </Link>
  );
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
      {pill('/profile', 'Assembled', 'assembled')}
      {pill('/profile?view=meter', 'Meter', 'meter')}
    </div>
  );
}

// Identity, the per-section evidence cards (Positions/STARs/Skills/Responsibilities/
// Education/Languages/Bullet bank), Improve, the Graph strength hero, and To
// strengthen all moved to /profile/story (R7 · "make room" for the Career Graph,
// then the strength/gaps hand-off requested alongside it) — see ComponentBar/
// StatTile/SectionCard/Peek/countBy there.
