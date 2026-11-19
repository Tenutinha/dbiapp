import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { canonicalSearchOf } from "@/lib/search-string";
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

/**
 * What the page shows while DashboardBody waits: a skeleton of the visuals (the header is already on
 * top of the content area, and the way to the previous dashboard is a popup that takes no room).
 */
export function DashboardFallback() {
  return <DashboardSkeleton />;
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
  // The ticket goes with every dashboard: besides the analyses left for later, it is what lets a click on a
  // visual or a filter bring only the numbers, without this page being made again (see dashboard/live).
  const later = { pending: dashboard.pending, ticket: issueSectionTicket({ instanceId, templateId, activeVersionId }), search: canonicalSearchOf(searchParams), version: activeVersionId };
  const view = <DashboardView template={dashboard.template} data={dashboard.data} totalRows={dashboard.totalRows} later={later} notesInSummary />;
  // A dashboard over the whole content area (a 3D map): the wheel belongs to it, so the ways to the
  // neighbouring dashboards (opened by scrolling past the page's ends) are left out; the summary still opens them.
  if (dashboard.template.fill) {
    return (
      <>
        <DashboardLanding anchorsKey={anchorsKey} />
        {view}
      </>
    );
  }
  return (
    <>
      <DashboardLanding anchorsKey={anchorsKey} />
      {/* At least a screen tall (less the header): the next dashboard only shows once the reader scrolls. */}
      <div className="min-h-[calc(100dvh-6rem)]">
        {before}
        {view}
      </div>
      {after}
    </>
  );
}
