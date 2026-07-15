import { ButtonLink } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="animate-fade-up text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Not found</h1>
        <p className="mt-2 text-sm text-ink-muted">That lead or page doesn&apos;t exist.</p>
        <ButtonLink href="/roleproof" className="mt-5">
          Back to the board
        </ButtonLink>
      </div>
    </div>
  );
}
