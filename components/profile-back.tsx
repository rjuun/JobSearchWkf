import Link from 'next/link';

export function ProfileBack() {
  return (
    <Link
      href="/profile"
      className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
    >
      <span aria-hidden>←</span> Career Graph
    </Link>
  );
}
