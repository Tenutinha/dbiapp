import { CardProgress } from "./CardProgress";

const BLOCK = "animate-pulse rounded-lg bg-text/10";

function CardSkeleton({ className, height }: { className: string; height: string }) {
  return (
    <div className={`card relative p-5 ${className}`}>
      <CardProgress />
      <div className={`${BLOCK} h-3 w-32`} />
      <div className={`${BLOCK} mt-4 ${height}`} />
    </div>
  );
}

/**
 * Shape of a dashboard while its numbers are being calculated: indicators, two charts and a table.
 * Shown the moment a dashboard is opened, so the screen changes at once and fills in when the data arrives.
 */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Carregando os dados do dashboard" className="pb-16">
      <div className={`${BLOCK} mb-6 h-8 w-28 rounded-full`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i} className="md:col-span-3" height="h-9 w-3/4" />
        ))}
        <CardSkeleton className="sm:col-span-2 md:col-span-8" height="h-72" />
        <CardSkeleton className="sm:col-span-2 md:col-span-4" height="h-72" />
        <CardSkeleton className="sm:col-span-2 md:col-span-12" height="h-80" />
      </div>
      <span className="sr-only">Carregando os dados…</span>
    </div>
  );
}
