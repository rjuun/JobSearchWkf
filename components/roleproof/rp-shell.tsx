import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { MachineryProvider } from '@/components/machinery';

/**
 * Frame for the leads side (the board + the lead workspace). Shares the one app
 * header; unlike AppShell it does not wrap content, because these pages choose
 * their own Frame width (the board/spine read narrow, the command center wide).
 */
export function RpShell({
  children,
  back,
}: {
  children: ReactNode;
  /** Optional breadcrumb back-link (e.g. from a workspace to the board). */
  back?: { href: string; label: string };
}) {
  return (
    <MachineryProvider>
      <div className="flex min-h-screen flex-col bg-canvas text-ink">
        <AppHeader back={back} />
        <main className="flex-1 animate-fade-in">{children}</main>
      </div>
    </MachineryProvider>
  );
}
