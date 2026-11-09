/**
 * Builds the organization's setup table (/<org>/admin), read as a hierarchy:
 * space (the organization, then each client) → its dashboards → the data feeding each one → who sees the space.
 *
 * In the database each space has its own copy of a dashboard (`dashboard_instances`, with its own
 * files); access is granted per space (organization staff, client users), so it sits on the space.
 */

/** A dashboard linked to one space, as `listOrgDashboards` returns it. */
export interface SetupInstance {
  id: string;
  name: string;
  templateId: string;
  /** Null for the organization's own space. */
  clientId: string | null;
  published: boolean;
  publishedAt: Date | null;
  hasDraft: boolean;
}

export interface SetupClient {
  id: string;
  name: string;
  slug: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  /** Tables the dashboard needs (its data contract). */
  tables?: readonly { name: string; kind: "fact" | "dimension" }[];
}

/** How many tables of each kind the dashboard needs, and how many already have a file (published or waiting). */
export interface TableProgress {
  fact: { required: number; sent: number };
  dimension: { required: number; sent: number };
}

/** "org" for the organization's own space, otherwise the client's id. */
export type Scope = string;

export const ORG_SCOPE = "org";

export interface SpaceDashboard {
  instanceId: string;
  templateId: string;
  name: string;
  published: boolean;
  publishedAt: Date | null;
  hasDraft: boolean;
  /** Number of files in the published version and in the draft waiting to be published. */
  files: { active: number; draft: number };
  /** Null when the dashboard is no longer in the catalog (its contract is unknown here). */
  tables: TableProgress | null;
}

export interface SpaceGroup {
  scope: Scope;
  name: string;
  /** Null for the organization's own space. */
  slug: string | null;
  dashboards: SpaceDashboard[];
  /** Catalog dashboards this space does not have yet. */
  available: CatalogEntry[];
}

type FileRef = { instanceId: string; status: "active" | "draft"; tableName: string };

function countFiles(files: readonly FileRef[], instanceId: string): SpaceDashboard["files"] {
  const mine = files.filter((f) => f.instanceId === instanceId);
  return {
    active: mine.filter((f) => f.status === "active").length,
    draft: mine.filter((f) => f.status === "draft").length,
  };
}

function tableProgress(entry: CatalogEntry | undefined, files: readonly FileRef[], instanceId: string): TableProgress | null {
  const tables = entry?.tables;
  if (!tables) return null;
  const sent = new Set(files.filter((f) => f.instanceId === instanceId).map((f) => f.tableName));
  const count = (kind: "fact" | "dimension") => {
    const required = tables.filter((t) => t.kind === kind);
    return { required: required.length, sent: required.filter((t) => sent.has(t.name)).length };
  };
  return { fact: count("fact"), dimension: count("dimension") };
}

export function buildSpaceGroups(
  instances: readonly SetupInstance[],
  clients: readonly SetupClient[],
  files: readonly FileRef[],
  catalog: readonly CatalogEntry[],
): SpaceGroup[] {
  const spaces = [
    { scope: ORG_SCOPE, name: "Organização", slug: null },
    ...clients.map((c) => ({ scope: c.id, name: c.name, slug: c.slug })),
  ];

  return spaces.map((space) => {
    const dashboards: SpaceDashboard[] = instances
      .filter((i) => (i.clientId ?? ORG_SCOPE) === space.scope)
      .map((i) => ({
        instanceId: i.id,
        templateId: i.templateId,
        name: i.name,
        published: i.published,
        publishedAt: i.publishedAt,
        hasDraft: i.hasDraft,
        files: countFiles(files, i.id),
        tables: tableProgress(catalog.find((t) => t.id === i.templateId), files, i.id),
      }));
    const linked = new Set(dashboards.map((d) => d.templateId));
    const available = catalog.filter((t) => !linked.has(t.id)).map((t) => ({ id: t.id, name: t.name }));
    return { ...space, dashboards, available };
  });
}
