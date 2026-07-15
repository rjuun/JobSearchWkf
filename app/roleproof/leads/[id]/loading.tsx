// Instant skeleton for the lead workspace while it loads (force-dynamic + LLM data).
export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-[58px] border-b border-hairline bg-surface/85" />
      <div className="mx-auto max-w-[1100px] px-5 pt-8 sm:px-6">
        <div className="h-8 w-44 animate-pulse rounded-field bg-hairline" />
        <div className="mt-6 h-3 w-32 animate-pulse rounded bg-hairline" />
        <div className="mt-2 h-9 w-2/3 animate-pulse rounded bg-hairline" />
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
          <div className="h-[420px] animate-pulse rounded-card border border-hairline bg-surface" />
          <div className="space-y-4">
            <div className="h-44 animate-pulse rounded-card border border-hairline bg-surface" />
            <div className="h-28 animate-pulse rounded-card border border-hairline bg-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}
