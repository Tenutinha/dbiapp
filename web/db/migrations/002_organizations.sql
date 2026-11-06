-- Organizations (tenants, e.g. /odeontecnologia) and their clients (e.g. /odeontecnologia/cliente1).
--
-- Organization staff (organization_members):
--   admin   → everything: users, clients, data, dashboards
--   editor  → uploads/publishes data and activates dashboards, for the org and all its clients
--   analyst → views + shares the organization's own dashboards
--   viewer  → views the organization's own dashboards
-- Client users (client_members) see only that client's dashboards:
--   analyst → views + shares, viewer → views

ALTER TABLE workspaces RENAME TO organizations;
ALTER TABLE workspace_members RENAME TO organization_members;
ALTER TABLE organization_members RENAME COLUMN workspace_id TO organization_id;
ALTER TABLE dashboard_instances RENAME COLUMN workspace_id TO organization_id;
ALTER INDEX dashboard_instances_workspace_idx RENAME TO dashboard_instances_org_idx;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$');

CREATE TABLE org_clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  slug             text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, id)
);

CREATE TABLE client_members (
  client_id   uuid NOT NULL REFERENCES org_clients(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'viewer' CHECK (role IN ('analyst', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX client_members_user_idx ON client_members(user_id);

-- NULL client_id = the organization's own dashboard.
-- The composite FK guarantees a dashboard's client belongs to the same organization.
ALTER TABLE dashboard_instances ADD COLUMN client_id uuid;
ALTER TABLE dashboard_instances
  ADD CONSTRAINT dashboard_instances_client_fk
  FOREIGN KEY (organization_id, client_id) REFERENCES org_clients(organization_id, id) ON DELETE CASCADE;
CREATE INDEX dashboard_instances_client_idx ON dashboard_instances(client_id);
CREATE INDEX organization_members_user_idx ON organization_members(user_id);
