// Instant skeleton for the dashboard while its aggregate query runs.
export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-[58px] border-b border-hairline bg-surface/85" />
      <div className="mx-auto max-w-[1100px] px-5 pt-8 sm:px-6">
        <div className="h-3 w-44 animate-pulse rounded bg-hairline" />
        <div className="mt-3 h-9 w-80 animate-pulse rounded bg-hairline" />
        <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface px-5 py-6">
              <div className="h-8 w-14 animate-pulse rounded bg-hairline" />
              <div className="mt-3 h-2.5 w-20 animate-pulse rounded bg-hairline" />
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="h-44 animate-pulse rounded-card border border-hairline bg-surface" />
          <div className="h-44 animate-pulse rounded-card border border-hairline bg-surface" />
        </div>
      </div>
    </div>
  );
}
