import { Suspense } from "react";
import { FiscalPanelBody, FiscalPanelFallback } from "@/components/fiscal-panel/FiscalPanelBody";
import { isFiscalPanel } from "@/lib/fiscal/panel";
import { requireInstance, type ClientRef, type InstanceAccess, type OrgRef } from "@/lib/access";
import { AccessError, type CurrentUser } from "@/lib/auth";
import { firstItem, nextItem, previousItem, type TocGroup } from "@/lib/layout/toc";
import type { Membership } from "@/lib/permissions";
import { loadSpace } from "@/lib/services/space";
import { getTemplate } from "@/lib/templates/registry";
import { buildOutline, type SummaryItem } from "@/lib/templates/sections";
import { readViewSelection } from "@/lib/view-selection";
import { DashboardArrival } from "./DashboardArrival";
import { DashboardBody, DashboardFallback } from "./DashboardBody";
import { NextDashboard } from "./NextDashboard";
import { DashboardOpener, DashboardSwitch } from "./switching";
import type { Notes, Outlines } from "./SidebarNav";
import { ScreenTitle, Workspace } from "./Workspace";

type SearchParams = Record<string, string | string[] | undefined>;

interface SpaceHomeProps {
  org: OrgRef;
  client: ClientRef | null;
  membership: Membership;
  user: CurrentUser;
  /** Dashboard filters (the only thing that ever follows the space's address). */
  searchParams: SearchParams;
}

/** A published dashboard of exactly this space that the user may view; null otherwise. */
async function openable(instanceId: string, org: OrgRef, client: ClientRef | null): Promise<InstanceAccess | null> {
  try {
    const access = await requireInstance(instanceId, "view", org.slug);
    const sameSpace = (access.client?.id ?? null) === (client?.id ?? null);
    return sameSpace && access.activeVersionId ? access : null;
  } catch (err) {
    if (err instanceof AccessError && err.status !== 401) return null;
    throw err;
  }
}

interface TemplateSummary {
  outline: SummaryItem[];
  description: string | null;
}

/**
 * Analyses of every dashboard in the summary, and what each dashboard is about (its own description,
 * else its template's), for the sidebar and its hover notes. A template that cannot be read only leaves
 * its dashboard without nested analyses; the page still opens.
 */
export async function loadOutlines(toc: readonly TocGroup[]): Promise<{ outlines: Outlines; notes: Notes }> {
  const items = toc.flatMap((g) => g.items);
  const templateIds = [...new Set(items.map((i) => i.templateId))];
  const loaded = await Promise.all(
    templateIds.map(async (id): Promise<[string, TemplateSummary]> => {
      try {
        const template = await getTemplate(id);
        return [id, { outline: template ? buildOutline(template) : [], description: template?.description.trim() || null }];
      } catch (err) {
        console.error(`[space] could not read the summary of template ${id}`, err);
        return [id, { outline: [], description: null }];
      }
    }),
  );
  const byTemplate = new Map(loaded);
  const outlines: Outlines = Object.fromEntries(items.map((i) => [i.id, byTemplate.get(i.templateId)?.outline ?? []]));
  const notes: Notes = Object.fromEntries(
    items.flatMap((i) => {
      const note = i.description?.trim() || byTemplate.get(i.templateId)?.description;
      return note ? [[i.id, note]] : [];
    }),
  );
  return { outlines, notes };
}

/**
 * The viewing screen of a space, always on its own address (`/<org>` or `/<org>/<client>`):
 * the dashboard last opened here, else the first one of the summary. Only dashboards — no data
 * setup (that lives in the administration). Nothing published yet: an empty screen.
 */
export async function SpaceHome({ org, client, membership, user, searchParams }: SpaceHomeProps) {
  const chosenId = await readViewSelection(client?.id ?? org.id);
  const [space, chosen] = await Promise.all([
    loadSpace(org, client, membership),
    chosenId ? openable(chosenId, org, client) : Promise.resolve(null),
  ]);

  const first = firstItem(space.toc);
  const access = chosen ?? (first ? await openable(first.id, org, client) : null);
  if (!access?.activeVersionId) {
    return <Workspace space={space} currentId={null} userName={user.name}>{null}</Workspace>;
  }

  // The panel of fiscal data has no visuals: it draws the space's fiscal files and tables itself.
  if (isFiscalPanel(access.templateId)) {
    const { outlines, notes } = await loadOutlines(space.toc);
    return (
      <Workspace space={space} currentId={access.instanceId} userName={user.name} outlines={outlines} notes={notes}>
        <DashboardArrival dashboardId={access.instanceId} />
        <div key={access.instanceId} className="dash-enter">
          <ScreenTitle title={access.name} />
          <Suspense fallback={<FiscalPanelFallback />}>
            <FiscalPanelBody org={org} client={client} canManage={access.actions.has("manageData")} />
          </Suspense>
        </div>
      </Workspace>
    );
  }

  // Only what the frame of the page needs is awaited here; the data arrives inside the Suspense below.
  const [template, { outlines, notes }] = await Promise.all([getTemplate(access.templateId), loadOutlines(space.toc)]);
  const anchorsKey = template ? buildOutline(template).map((i) => i.anchor).join("|") : "";
  const next = nextItem(space.toc, access.instanceId);
  const previous = previousItem(space.toc, access.instanceId);
  // Only the visuals on screen: the sidebar names the space, the open dashboard and when it was updated;
  // sharing is done by the organization's admins, in the administration.
  const header = <ScreenTitle title={access.name} />;

  return (
    <Workspace
      space={space}
      currentId={access.instanceId}
      userName={user.name}
      outlines={outlines}
      notes={notes}
    >
      <DashboardArrival dashboardId={access.instanceId} />
      <DashboardSwitch>
      {/* Keyed by dashboard: a new one fades in (dash-enter) instead of patching the previous page. */}
      <div key={access.instanceId} className="dash-enter">
        <DashboardOpener />
        {/* A new dashboard opens at once as a skeleton; a filter change keeps the page and only its cards wait. */}
        <Suspense fallback={<DashboardFallback header={header} hasPrevious={previous !== null} />}>
          <DashboardBody
            instanceId={access.instanceId}
            templateId={access.templateId}
            activeVersionId={access.activeVersionId}
            searchParams={searchParams}
            anchorsKey={anchorsKey}
            before={
              <>
                {previous && <NextDashboard direction="previous" id={previous.id} name={previous.name} number={previous.number} />}
                {header}
              </>
            }
            after={next && <NextDashboard id={next.id} name={next.name} number={next.number} />}
          />
        </Suspense>
      </div>
      </DashboardSwitch>
    </Workspace>
  );
}
