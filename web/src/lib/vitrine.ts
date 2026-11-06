/**
 * Public showcase (/vitrine) of published catalog dashboards. Pure helpers, no I/O.
 */
import { can, type Role } from "./permissions";
import type { Template } from "./templates/schema";

export const VITRINE_ORIGINS = ["powerbi", "qlikview"] as const;
export type VitrineOrigin = (typeof VITRINE_ORIGINS)[number];

/** What the showcase needs from a template — no SQL or internal definitions. */
export interface VitrineItem {
  id: string;
  name: string;
  area: string;
  origin: VitrineOrigin;
  description: string;
  tables: string[];
}

export interface VitrineQuery {
  q?: string;
  area?: string;
  origin?: VitrineOrigin;
}

const MAX_QUERY = 80;

export function toVitrineItem(t: Template): VitrineItem {
  return {
    id: t.id,
    name: t.name,
    area: t.area,
    origin: t.origin,
    description: t.description,
    tables: t.tables.map((tb) => tb.name),
  };
}

const single = (v: string | string[] | undefined): string | undefined => {
  const s = typeof v === "string" ? v.trim() : undefined;
  return s ? s : undefined;
};

export function parseVitrineQuery(params: Record<string, string | string[] | undefined>): VitrineQuery {
  const origin = single(params.origem);
  return {
    q: single(params.q)?.slice(0, MAX_QUERY),
    area: single(params.area)?.slice(0, MAX_QUERY),
    origin: VITRINE_ORIGINS.find((o) => o === origin),
  };
}

const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterVitrine(items: readonly VitrineItem[], query: VitrineQuery): VitrineItem[] {
  const needle = query.q ? normalize(query.q) : null;
  return items.filter((i) => {
    if (query.area && i.area !== query.area) return false;
    if (query.origin && i.origin !== query.origin) return false;
    if (!needle) return true;
    const haystack = normalize([i.name, i.area, i.description, ...i.tables].join(" "));
    return haystack.includes(needle);
  });
}

export function vitrineAreas(items: readonly VitrineItem[]): string[] {
  return [...new Set(items.map((i) => i.area))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

interface OrgOption {
  id: string;
  slug: string;
  name: string;
  orgRole: Role | null;
}

/** Organizations where the user may add a dashboard (same rule as the in-org catalog). */
export function orgsThatCanAdd<T extends OrgOption>(orgs: readonly T[], platformAdmin: boolean): T[] {
  return orgs.filter((o) => can({ orgRole: o.orgRole, clientRoles: {}, platformAdmin }, { clientId: null }, "manageData"));
}
