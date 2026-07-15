import Link from 'next/link';
import { getCareerGraph } from '@/lib/queries';
import { strengthOf } from '@/lib/career-graph';
import { cn } from '@/components/ui';

/**
 * Ambient "Career Graph strength" chip for the app header — makes the moat (the
 * evidence asset) felt everywhere, and is a one-tap route home to it. Server
 * component; computes strength deterministically from the graph.
 */
export async function GraphStrengthChip({ className }: { className?: string }) {
  const g = await getCareerGraph();
  const { score, label } = strengthOf(g);
  const tone =
    score >= 75
      ? 'bg-proof-soft text-proof-deep ring-proof-ring'
      : score >= 50
        ? 'bg-caution-soft text-caution-deep ring-caution-ring'
        : 'bg-raised text-ink-muted ring-hairline';
  return (
    <Link
      href="/profile"
      title={`Career Graph · ${label} (${score}/100)`}
      className={cn(
        'items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset transition hover:opacity-90',
        tone,
        // Display is caller-controlled so the header can hide it on mobile only
        // when a back-link already occupies the space (the workspace).
        className ?? 'inline-flex'
      )}
    >
      <span aria-hidden className="text-[10px]">
        ◆
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Graph</span>
      <span className="font-serif text-[14px] leading-none tabular-nums">{score}</span>
    </Link>
  );
}
