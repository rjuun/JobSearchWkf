'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui';

const NAV = [
  { href: '/profile', label: 'Career Graph' },
  { href: '/roleproof', label: 'Leads' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pipeline', label: 'Pipeline' },
];

// `extra` carries flag-gated destinations decided server-side (e.g. the Statement,
// Additive Plan · B1) so this client component never needs to read env itself.
export function NavLinks({ extra = [] }: { extra?: { href: string; label: string }[] }) {
  const path = usePathname() ?? '';
  const nav = [...NAV, ...extra];
  return (
    // Hidden on mobile: the wordmark (→ Leads) and the Graph chip (→ Career Graph)
    // already reach both destinations there, so the inline nav is redundant and
    // only crowds the header. It returns at sm+ where there's room.
    <nav className="hidden items-center gap-1 text-sm sm:flex">
      {nav.map((n) => {
        const active = path === n.href || path.startsWith(n.href + '/');
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition',
              active ? 'bg-raised text-ink' : 'text-ink-muted hover:bg-raised hover:text-ink'
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
