export function Shimmer({ className = "" }: { className?: string }) {
  return <span className={`skeleton-shimmer block rounded-md ${className}`} />;
}

export function BoardSkeleton() {
  return (
    <div className="space-y-8 p-5" aria-busy="true" aria-label="Loading ward board">
      {[0, 1].map((bay) => (
        <div key={bay}>
          <Shimmer className="mb-5 h-3 w-28" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-panel p-5">
                <Shimmer className="h-4 w-2/3" />
                <Shimmer className="mt-3 h-3 w-full" />
                <Shimmer className="mt-2 h-3 w-4/5" />
                <Shimmer className="mt-4 h-6 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading activity">
      <Shimmer className="h-20 w-full rounded-xl" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <Shimmer className="size-3 shrink-0 rounded-full" />
          <div className="flex-1">
            <Shimmer className="h-3.5 w-1/2" />
            <Shimmer className="mt-2 h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightsSkeleton() {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2" aria-busy="true" aria-label="Loading insights">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-panel p-4">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="mt-4 h-7 w-1/2" />
          <Shimmer className="mt-4 h-1.5 w-full" />
          <Shimmer className="mt-4 h-3 w-full" />
          <Shimmer className="mt-2 h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

export function DemoSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading demo studio">
      <div className="rounded-2xl border border-border bg-panel p-5">
        <Shimmer className="h-3 w-28" />
        <Shimmer className="mt-3 h-6 w-2/3" />
        <Shimmer className="mt-2 h-3 w-full" />
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Shimmer key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <Shimmer className="h-64 w-full rounded-2xl" />
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
