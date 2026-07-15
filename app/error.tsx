'use client';

import { Button } from '@/components/ui';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="max-w-md animate-fade-up rounded-card border border-hairline bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-xl font-bold text-rose-600 ring-1 ring-inset ring-rose-100">
          !
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted">{error.message || 'An unexpected error occurred.'}</p>
        <Button onClick={reset} className="mt-5">
          Try again
        </Button>
      </div>
    </div>
  );
}
