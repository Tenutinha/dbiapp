/**
 * Loads organizations / clients / dashboards for the current user and enforces permissions.
 * Anything the user may not view answers 404, so existence of other tenants never leaks.
 */
import "server-only";
import { cache } from "react";
import { AccessError, getCurrentUser, type CurrentUser } from "./auth";
import { sql } from "./db";
import { allowedActions, canSeeDashboard, isMember, type Action, type ClientRole, type Membership, type Role } from "./permissions";

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

/** What the organization's own pages get: its context and the optional modules it has on (e.g. ["controle"]). */
export interface OrgHome extends OrgContext {
  modules: readonly string[];
}

export interface ClientContext extends OrgHome {
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

interface MembershipRow {
  orgRole: Role | null;
  clientRoles: Record<string, ClientRole> | null;
}

/**
 * The user's staff role and client roles in an organization, as SQL columns. Kept in one
 * statement: every round trip to the database costs ~200 ms from outside its region.
 */
const membershipColumns = (userId: string, orgIdColumn: ReturnType<typeof sql>) => sql`
  (SELECT m.role FROM organization_members m
   WHERE m.organization_id = ${orgIdColumn} AND m.user_id = ${userId}) AS "orgRole",
  (SELECT jsonb_object_agg(cm.client_id, cm.role)
   FROM client_members cm JOIN org_clients c ON c.id = cm.client_id
   WHERE cm.user_id = ${userId} AND c.organization_id = ${orgIdColumn}) AS "clientRoles"`;

const toMembership = (row: MembershipRow, platformAdmin: boolean): Membership => ({
  orgRole: row.orgRole ?? null,
  clientRoles: { ...(row.clientRoles ?? {}) },
  platformAdmin,
});

export const getOrgContext = cache(async (orgSlug: string): Promise<OrgHome> => {
  const user = await getCurrentUser();
  // The modules come along (null before migration 015): the client's page needs them, and asking apart is one more round trip.
  const [row] = await sql<(OrgRef & MembershipRow & { modules: string[] | null })[]>`
    SELECT o.id, o.slug, o.name, to_jsonb(o) -> 'modules' AS modules, ${membershipColumns(user.id, sql`o.id`)}
    FROM organizations o WHERE o.slug = ${orgSlug}`;
  if (!row) throw notFound();
  const membership = toMembership(row, user.isPlatformAdmin);
  if (!isMember(membership)) throw notFound();
  return { user, org: { id: row.id, slug: row.slug, name: row.name }, membership, modules: row.modules ?? [] };
});

export const getClientContext = cache(async (orgSlug: string, clientSlug: string): Promise<ClientContext> => {
  // Asked together with the organization (by the two addresses), not after it: what it finds is only
  // looked at once the organization's own check has passed.
  const found = sql<ClientRef[]>`
    SELECT c.id, c.slug, c.name FROM org_clients c JOIN organizations o ON o.id = c.organization_id
    WHERE o.slug = ${orgSlug} AND c.slug = ${clientSlug}`.then((rows) => rows, () => null);
  const ctx = await getOrgContext(orgSlug);
  const rows = await found;
  // The lookup itself failed (the database, not the address): asked again, so the error is the real one.
  const [client] = rows ?? await sql<ClientRef[]>`
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
  /** The template's extra restriction (template field `access`), if any. */
  access: string | null;
}

/**
 * Loads a dashboard and checks `action` against its scope (org or client).
 * When `orgSlug` is given (URL), the dashboard must belong to that organization.
 */
export async function requireInstance(instanceId: string, action: Action, orgSlug?: string): Promise<InstanceAccess> {
  if (!UUID.test(instanceId)) throw notFound();
  const user = await getCurrentUser();
  // The person's roles come in the same statement as the dashboard, not in a second one.
  const [row] = await sql<(InstanceRow & MembershipRow)[]>`
    SELECT i.id AS "instanceId", i.template_id AS "templateId", i.name, i.active_version_id AS "activeVersionId",
           i.description, v.published_at AS "publishedAt",
           o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName",
           c.id AS "clientId", c.slug AS "clientSlug", c.name AS "clientName",
           (SELECT t.definition ->> 'access' FROM dashboard_templates t WHERE t.id = i.template_id) AS access,
           ${membershipColumns(user.id, sql`o.id`)}
    FROM dashboard_instances i
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN org_clients c ON c.id = i.client_id
    LEFT JOIN dataset_versions v ON v.id = i.active_version_id
    WHERE i.id = ${instanceId} AND i.archived_at IS NULL`;
  if (!row || (orgSlug !== undefined && row.orgSlug !== orgSlug)) throw notFound();

  const membership = toMembership(row, user.isPlatformAdmin);
  // A dashboard restricted to the platform administrator does not exist for anyone else.
  if (!canSeeDashboard(membership, row.access)) throw notFound();
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
