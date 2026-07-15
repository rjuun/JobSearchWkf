import Link from 'next/link';
import { getProfile } from '@/lib/queries';
import { logoutAction } from '@/app/actions/auth';
import { NavLinks } from '@/components/nav-links';
import { GraphStrengthChip } from '@/components/graph-strength-chip';
import { MachineryToggle } from '@/components/machinery';
import { env, isLiveLlm } from '@/lib/env';

/**
 * The shared app header — identical on every page (full-bleed, fixed gutter):
 * wordmark, optional breadcrumb back-link, primary nav, and the signed-in user.
 * Server component — reads the real signed-in user. Both shells render this so
 * the frame never diverges between the Career Graph and the leads side.
 */
export async function AppHeader({ back }: { back?: { href: string; label: string } }) {
  const profile = await getProfile();
  const name = profile?.name ?? 'You';
  const initials =
    name
      .split(' ')
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'Y';

  return (
    <header className="sticky top-0 z-30 flex h-[58px] items-center gap-4 border-b border-hairline bg-surface/85 px-5 backdrop-blur-md sm:px-6">
      <Link href="/profile" className="flex shrink-0 items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-proof text-[13px] font-bold text-white">
          R
        </span>
        <span className="text-[15px] font-bold tracking-tight text-ink">RoleProof</span>
      </Link>
      {back && (
        <Link
          href={back.href}
          className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-ink-muted transition hover:text-ink"
        >
          ← {back.label}
        </Link>
      )}
      <NavLinks
        extra={[
          ...(env.nextDiscover ? [{ href: '/discover', label: 'Discover' }] : []),
          ...(env.nextStatement ? [{ href: '/statement', label: 'Statement' }] : []),
        ]}
      />
      <div className="ml-auto flex items-center gap-3">
        {/* Whether the pipeline's judgments are real LLM calls or deterministic
            mock fixtures — so you always know what you're trusting. Dev chrome:
            gated behind SHOW_LLM_PILL so a clean demo never shows it. */}
        {env.showLlmPill && (
          <span
            title={isLiveLlm ? `Live LLM · ${env.deepseekModelChat}` : 'Mock mode · deterministic fixtures (no API key)'}
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset md:inline-flex ${
              isLiveLlm ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-amber-100'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isLiveLlm ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {isLiveLlm ? 'LIVE' : 'MOCK'}
          </span>
        )}
        {/* The "two speeds" toggle — reveals step codes / formula / ref_codes. */}
        <MachineryToggle className="hidden md:inline-flex" />
        {/* On mobile the chip is the route to the Career Graph (nav is hidden there),
            except on the workspace where the back-link takes that slot. */}
        <GraphStrengthChip className={back ? 'hidden sm:inline-flex' : 'inline-flex'} />
        <span className="hidden text-[13px] text-ink-muted sm:inline">{name}</span>
        <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-ink text-[12px] font-bold text-paper">
          {initials}
        </span>
        {/* Switch to (or add) another account — logging in as a different user swaps
            the session; /login links onward to /signup for a brand-new empty graph. */}
        <Link
          href="/login"
          className="hidden whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-muted transition hover:bg-raised hover:text-ink sm:inline-block"
        >
          Switch account
        </Link>
        <form action={logoutAction}>
          <button className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-muted transition hover:bg-raised hover:text-ink">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
