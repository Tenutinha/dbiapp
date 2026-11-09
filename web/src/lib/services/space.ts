import "server-only";
import type { ClientRef, OrgRef } from "../access";
import { getEffectiveBranding } from "../data/branding";
import { getSpaceLayout } from "../data/layout";
import { listClients } from "../data/organizations";
import { buildToc, type TocGroup } from "../layout/toc";
import type { Theme } from "../theme/theme";
import { spaceOptions, type SpaceOption } from "../space-options";
import { allowedActions, visibleClientIds, type Action, type Membership } from "../permissions";

export interface SpaceView {
  org: OrgRef;
  client: ClientRef | null;
  actions: ReadonlySet<Action>;
  /** Org admin (for the "Administração" link). */
  isOrgAdmin: boolean;
  /** Platform administrator ("admin master"). */
  isPlatformAdmin: boolean;
  toc: TocGroup[];
  theme: Theme;
  logoUrl: string | null;
  /**
   * Every space this person can open in this organization (the organization itself, then its clients),
   * with the current one marked — the sidebar's client switcher. One entry = no choice to make.
   */
  spaces: SpaceOption[];
}

export async function loadSpace(org: OrgRef, client: ClientRef | null, membership: Membership): Promise<SpaceView> {
  const actions = allowedActions(membership, { clientId: client?.id ?? null });
  const orgScope = allowedActions(membership, { clientId: null });

  const clientId = client?.id ?? null;
  const [layout, clients, branding] = await Promise.all([
    getSpaceLayout({ orgId: org.id, clientId }),
    listClients(org.id),
    getEffectiveBranding(org.id, clientId),
  ]);
  const visible = new Set(visibleClientIds(membership, clients.map((c) => c.id)));

  return {
    org,
    client,
    actions,
    isOrgAdmin: orgScope.has("admin"),
    isPlatformAdmin: membership.platformAdmin === true,
    theme: branding.theme,
    logoUrl: branding.logoUrl,
    // The viewing screen lists only what can be viewed; data work lives in the administration.
    toc: buildToc(layout.sections, layout.dashboards, { includeUnpublished: false, includeEmptySections: false }),
    spaces: spaceOptions(org, clientId, orgScope.has("view"), clients.filter((c) => visible.has(c.id) || c.id === clientId)),
  };
}
