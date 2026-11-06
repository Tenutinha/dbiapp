/**
 * Loads organizations / clients / dashboards for the current user and enforces permissions.
 * Anything the user may not view answers 404, so existence of other tenants never leaks.
 */
import "server-only";
import { cache } from "react";
import { AccessError, getCurrentUser, type CurrentUser } from "./auth";
import { sql } from "./db";
import { allowedActions, isMember, type Action, type ClientRole, type Membership, type Role } from "./permissions";

export interface OrgRef {
  id: string;
  slug: string;
  name: string;
}
export interface ClientRef {
  id: string;
  slug: string;
  name: string;
}

export interface OrgContext {
  user: CurrentUser;
  org: OrgRef;
  membership: Membership;
}

export interface ClientContext extends OrgContext {
  client: ClientRef;
  actions: ReadonlySet<Action>;
}

export interface InstanceAccess extends OrgContext {
  client: ClientRef | null;
  actions: ReadonlySet<Action>;
  instanceId: string;
  templateId: string;
  name: string;
  activeVersionId: string | null;
  description: string | null;
  publishedAt: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (): AccessError => new AccessError(404, "Não encontrado.");

const loadMembership = cache(async (userId: string, orgId: string, platformAdmin: boolean): Promise<Membership> => {
  const [staff] = await sql<{ role: Role }[]>`
    SELECT role FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}`;
  const clients = await sql<{ clientId: string; role: ClientRole }[]>`
    SELECT cm.client_id AS "clientId", cm.role
    FROM client_members cm JOIN org_clients c ON c.id = cm.client_id
    WHERE cm.user_id = ${userId} AND c.organization_id = ${orgId}`;
  return {
    orgRole: staff?.role ?? null,
    clientRoles: Object.fromEntries(clients.map((c) => [c.clientId, c.role])),
    platformAdmin,
  };
});

export const getOrgContext = cache(async (orgSlug: string): Promise<OrgContext> => {
  const user = await getCurrentUser();
  const [org] = await sql<OrgRef[]>`SELECT id, slug, name FROM organizations WHERE slug = ${orgSlug}`;
  if (!org) throw notFound();
  const membership = await loadMembership(user.id, org.id, user.isPlatformAdmin);
  if (!isMember(membership)) throw notFound();
  return { user, org, membership };
});

export const getClientContext = cache(async (orgSlug: string, clientSlug: string): Promise<ClientContext> => {
  const ctx = await getOrgContext(orgSlug);
  const [client] = await sql<ClientRef[]>`
    SELECT id, slug, name FROM org_clients WHERE organization_id = ${ctx.org.id} AND slug = ${clientSlug}`;
  if (!client) throw notFound();
  const actions = allowedActions(ctx.membership, { clientId: client.id });
  if (!actions.has("view")) throw notFound();
  return { ...ctx, client, actions };
});

/** Actions on the organization scope itself (its own dashboards, catalog, admin). */
export function orgActions(ctx: OrgContext): ReadonlySet<Action> {
  return allowedActions(ctx.membership, { clientId: null });
}

export function requireAction(actions: ReadonlySet<Action>, action: Action): void {
  if (!actions.has("view")) throw notFound();
  if (!actions.has(action)) throw new AccessError(403, "Seu papel não permite esta ação.");
}

export interface SpaceAccess {
  ctx: OrgContext;
  client: ClientRef | null;
  space: { orgId: string; clientId: string | null };
}

/** Checks `action` on a space: the organization itself, or one of its clients when `clientSlug` is given. */
export async function requireSpaceAction(orgSlug: string, clientSlug: string | null, action: Action): Promise<SpaceAccess> {
  if (clientSlug) {
    const ctx = await getClientContext(orgSlug, clientSlug);
    requireAction(ctx.actions, action);
    return { ctx, client: ctx.client, space: { orgId: ctx.org.id, clientId: ctx.client.id } };
  }
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), action);
  return { ctx, client: null, space: { orgId: ctx.org.id, clientId: null } };
}

interface InstanceRow {
  instanceId: string;
  templateId: string;
  name: string;
  activeVersionId: string | null;
  description: string | null;
  publishedAt: Date | null;
  orgId: string;
  orgSlug: string;
  orgName: string;
  clientId: string | null;
  clientSlug: string | null;
  clientName: string | null;
}

/**
 * Loads a dashboard and checks `action` against its scope (org or client).
 * When `orgSlug` is given (URL), the dashboard must belong to that organization.
 */
export async function requireInstance(instanceId: string, action: Action, orgSlug?: string): Promise<InstanceAccess> {
  if (!UUID.test(instanceId)) throw notFound();
  const user = await getCurrentUser();
  const [row] = await sql<InstanceRow[]>`
    SELECT i.id AS "instanceId", i.template_id AS "templateId", i.name, i.active_version_id AS "activeVersionId",
           i.description, v.published_at AS "publishedAt",
           o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName",
           c.id AS "clientId", c.slug AS "clientSlug", c.name AS "clientName"
    FROM dashboard_instances i
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN org_clients c ON c.id = i.client_id
    LEFT JOIN dataset_versions v ON v.id = i.active_version_id
    WHERE i.id = ${instanceId}`;
  if (!row || (orgSlug !== undefined && row.orgSlug !== orgSlug)) throw notFound();

  const membership = await loadMembership(user.id, row.orgId, user.isPlatformAdmin);
  const actions = allowedActions(membership, { clientId: row.clientId });
  requireAction(actions, action);

  return {
    user,
    org: { id: row.orgId, slug: row.orgSlug, name: row.orgName },
    membership,
    client: row.clientId ? { id: row.clientId, slug: row.clientSlug ?? "", name: row.clientName ?? "" } : null,
    actions,
    instanceId: row.instanceId,
    templateId: row.templateId,
    name: row.name,
    activeVersionId: row.activeVersionId,
    description: row.description,
    publishedAt: row.publishedAt,
  };
}

export interface UserOrg extends OrgRef {
  orgRole: Role | null;
}

/** Organizations the user belongs to (as staff or through a client); platform admins see every organization. */
export async function listUserOrganizations(userId: string, platformAdmin = false): Promise<UserOrg[]> {
  return sql<UserOrg[]>`
    SELECT o.id, o.slug, o.name, om.role AS "orgRole"
    FROM organizations o
    LEFT JOIN organization_members om ON om.organization_id = o.id AND om.user_id = ${userId}
    WHERE ${platformAdmin} OR om.user_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM client_members cm JOIN org_clients c ON c.id = cm.client_id
      WHERE cm.user_id = ${userId} AND c.organization_id = o.id)
    ORDER BY o.name`;
}
