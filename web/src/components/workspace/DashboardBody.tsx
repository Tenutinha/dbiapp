import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { issueSectionTicket } from "@/lib/section-ticket";
import { loadDashboard } from "@/lib/services/dashboard";
import { DashboardLanding } from "./DashboardArrival";

interface DashboardBodyProps {
  instanceId: string;
  templateId: string;
  activeVersionId: string;
  /** The open dashboard's filters and picked items. */
  searchParams: Readonly<Record<string, string | string[] | undefined>>;
  /** Section anchors of this dashboard, joined by "|". */
  anchorsKey: string;
  /** Shown above the visuals once they are ready (the way back to the previous dashboard, the header). */
  before: React.ReactNode;
  /** Shown under the visuals once they are ready (the way on to the next dashboard). */
  after: React.ReactNode;
}

/** The page's search params as one query string, in a stable order (it tells a selection from another). */
function searchString(searchParams: Readonly<Record<string, string | string[] | undefined>>): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(searchParams).sort()) {
    const value = searchParams[name];
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, v);
  }
  return query.toString();
}

/**
 * What the page shows while DashboardBody waits: the header already in place and a skeleton of the
 * visuals. The gap on top stands for the "previous dashboard" line, so the header does not jump when
 * the real page takes over.
 */
export function DashboardFallback({ header, hasPrevious }: { header: React.ReactNode; hasPrevious: boolean }) {
  return (
    <>
      {hasPrevious && <div aria-hidden className="mb-8 h-[45px]" />}
      {header}
      <DashboardSkeleton />
    </>
  );
}

/**
 * The part of the dashboard page that waits for the data. It is rendered inside a Suspense boundary, so
 * the page opens at once with a skeleton and this takes its place when the queries finish. The ways to
 * the neighbouring dashboards come with it: they only make sense on a page that has its full height.
 */
export async function DashboardBody({
  instanceId, templateId, activeVersionId, searchParams, anchorsKey, before, after,
}: DashboardBodyProps) {
  // Only the first analysis is computed with the page; the others arrive when the reader gets near them.
  const dashboard = await loadDashboard(instanceId, templateId, activeVersionId, searchParams, "opening");
  const later = dashboard.pending.length > 0
    ? { pending: dashboard.pending, ticket: issueSectionTicket({ instanceId, templateId, activeVersionId }), search: searchString(searchParams) }
    : undefined;
  return (
    <>
      <DashboardLanding anchorsKey={anchorsKey} />
      {before}
      <DashboardView template={dashboard.template} data={dashboard.data} totalRows={dashboard.totalRows} later={later} notesInSummary />
      {after}
    </>
  );
}
