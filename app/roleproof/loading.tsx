// Instant skeleton for the board while leads load (the page is force-dynamic).
export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-[58px] border-b border-hairline bg-surface/85" />
      <div className="mx-auto max-w-[1100px] px-5 pt-8 sm:px-6">
        <div className="h-3 w-40 animate-pulse rounded bg-hairline" />
        <div className="mt-3 h-9 w-72 animate-pulse rounded bg-hairline" />
        <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface px-5 py-6">
              <div className="h-8 w-12 animate-pulse rounded bg-hairline" />
              <div className="mt-3 h-2.5 w-16 animate-pulse rounded bg-hairline" />
            </div>
          ))}
        </div>
        <div className="mt-9 space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-card border border-hairline bg-surface px-5 py-4">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded bg-hairline" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-hairline" />
                <div className="h-2.5 w-1/3 animate-pulse rounded bg-hairline" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
