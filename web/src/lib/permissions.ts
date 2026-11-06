/**
 * Who can do what. Pure functions, no I/O — the single source of truth for access rules.
 *
 * Organization staff:
 *   admin   → everything (users, clients, data, dashboards), org + all clients
 *   editor  → data + dashboards + share, org + all clients
 *   analyst → view + share the organization's own dashboards
 *   viewer  → view the organization's own dashboards
 * Client users (only their client's dashboards):
 *   analyst → view + share
 *   viewer  → view
 */

export const ROLES = ["admin", "editor", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const CLIENT_ROLES = ["analyst", "viewer"] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

export type Action = "view" | "share" | "manageData" | "admin";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor de dados",
  analyst: "Analista",
  viewer: "Leitor",
};

export interface Membership {
  /** Role in the organization staff, if any. */
  orgRole: Role | null;
  /** Roles the user has per client of this organization (client id → role). */
  clientRoles: Readonly<Record<string, ClientRole>>;
  /** Platform administrator ("admin master"): everything, in every organization and client. */
  platformAdmin?: boolean;
}

const ALL_ACTIONS: readonly Action[] = ["view", "share", "manageData", "admin"];

/** The scope being accessed: the organization itself (clientId null) or one of its clients. */
export interface Scope {
  clientId: string | null;
}

const STAFF_ALL_SCOPES: Record<Role, readonly Action[]> = {
  admin: ["view", "share", "manageData", "admin"],
  editor: ["view", "share", "manageData"],
  analyst: [],
  viewer: [],
};

const STAFF_ORG_SCOPE: Record<Role, readonly Action[]> = {
  admin: ["view", "share", "manageData", "admin"],
  editor: ["view", "share", "manageData"],
  analyst: ["view", "share"],
  viewer: ["view"],
};

const CLIENT_SCOPE: Record<ClientRole, readonly Action[]> = {
  analyst: ["view", "share"],
  viewer: ["view"],
};

export function allowedActions(m: Membership, scope: Scope): ReadonlySet<Action> {
  if (m.platformAdmin) return new Set(ALL_ACTIONS);
  const actions = new Set<Action>();
  if (m.orgRole) {
    const staff = scope.clientId === null ? STAFF_ORG_SCOPE[m.orgRole] : STAFF_ALL_SCOPES[m.orgRole];
    staff.forEach((a) => actions.add(a));
  }
  if (scope.clientId !== null) {
    const clientRole = m.clientRoles[scope.clientId];
    if (clientRole) CLIENT_SCOPE[clientRole].forEach((a) => actions.add(a));
  }
  return actions;
}

export function can(m: Membership, scope: Scope, action: Action): boolean {
  return allowedActions(m, scope).has(action);
}

/** Whether the user belongs to the organization at all (staff or any client). */
export function isMember(m: Membership): boolean {
  return m.platformAdmin === true || m.orgRole !== null || Object.keys(m.clientRoles).length > 0;
}

/** Clients whose page the user may open. Staff admin/editor see all of them. */
export function visibleClientIds(m: Membership, allClientIds: readonly string[]): string[] {
  return allClientIds.filter((id) => can(m, { clientId: id }, "view"));
}

// ---------- slugs ----------

/** Path segments used by the app itself — cannot be organization or client slugs. */
export const RESERVED_SLUGS = new Set([
  "api", "s", "d", "admin", "entrar", "login", "logout", "dev", "app", "www", "static", "public",
  "_next", "favicon-ico", "robots-txt", "sitemap-xml", "novo", "config", "configuracoes", "catalogo", "plataforma", "auth",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** "Cliente Número 1" → "cliente-numero-1" */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
