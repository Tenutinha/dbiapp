-- DBI — initial setup for a fresh Supabase project.
-- Paste into Supabase → SQL Editor → Run. Safe to run once on an empty project.
-- Generated from db/migrations/*.sql — regenerate it when a migration is added.

BEGIN;

-- ===== 001_init.sql =====
-- DBI core schema. Postgres-compatible with Supabase (gen_random_uuid is built in on PG13+).

CREATE TYPE member_role AS ENUM ('admin', 'editor', 'analyst', 'viewer');
CREATE TYPE version_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         member_role NOT NULL DEFAULT 'viewer',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- A template from the catalog activated in a workspace.
CREATE TABLE dashboard_instances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id        text NOT NULL,
  name               text NOT NULL,
  active_version_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_instances_workspace_idx ON dashboard_instances(workspace_id);

-- A set of uploaded tables. Only one 'active' version per instance; uploads go to the 'draft'.
CREATE TABLE dataset_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES dashboard_instances(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  status        version_status NOT NULL DEFAULT 'draft',
  report        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  UNIQUE (instance_id, version)
);
CREATE UNIQUE INDEX dataset_versions_one_draft ON dataset_versions(instance_id) WHERE status = 'draft';

ALTER TABLE dashboard_instances
  ADD CONSTRAINT dashboard_instances_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES dataset_versions(id) ON DELETE SET NULL;

CREATE TABLE dataset_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  table_name    text NOT NULL,
  storage_path  text NOT NULL,
  row_count     bigint NOT NULL,
  size_bytes    bigint NOT NULL,
  original_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, table_name)
);

CREATE TABLE share_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid NOT NULL REFERENCES dashboard_instances(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  created_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_links_instance_idx ON share_links(instance_id);

-- ===== 002_organizations.sql =====
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

-- ===== 003_dashboard_sections.sql =====
-- Sidebar organisation: each space (organization itself, or one client) has ordered sections,
-- and each dashboard has a position, an optional section and an optional subtitle.

CREATE TABLE dashboard_sections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES org_clients(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX dashboard_sections_scope_idx ON dashboard_sections(organization_id, client_id);

ALTER TABLE dashboard_instances
  ADD COLUMN section_id uuid REFERENCES dashboard_sections(id) ON DELETE SET NULL,
  ADD COLUMN position integer NOT NULL DEFAULT 0,
  ADD COLUMN description text CHECK (description IS NULL OR char_length(description) <= 280);

ALTER TABLE dashboard_instances ADD CONSTRAINT dashboard_instances_name_len CHECK (char_length(name) BETWEEN 1 AND 120);

-- Existing dashboards keep their creation order.
UPDATE dashboard_instances i SET position = o.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id, client_id ORDER BY created_at) AS rn
      FROM dashboard_instances) o
WHERE o.id = i.id;

-- ===== 004_branding.sql =====
-- Per-space branding: the organization (client_id NULL) or one client (overrides the org's).
CREATE TABLE space_branding (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid,
  primary_color    text CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  secondary_color  text CHECK (secondary_color ~ '^#[0-9a-f]{6}$'),
  sidebar_color    text CHECK (sidebar_color ~ '^#[0-9a-f]{6}$'),
  appearance       text CHECK (appearance IN ('dark', 'light')),
  -- Logo file lives in storage/_branding/<org>/<logo_key>.<ext>; the key is the public, unguessable URL id.
  logo_key         uuid UNIQUE,
  logo_path        text,
  logo_mime        text CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES org_clients(organization_id, id) ON DELETE CASCADE,
  CHECK ((logo_key IS NULL) = (logo_path IS NULL) AND (logo_key IS NULL) = (logo_mime IS NULL))
);

-- One row per space (NULL client = the organization itself).
CREATE UNIQUE INDEX space_branding_scope_idx
  ON space_branding (organization_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ===== 005_platform_admin.sql =====
-- Platform administrators ("admin master"): full access to every organization and client,
-- and the only ones who can create organizations.
ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

-- ===== 006_enable_rls.sql =====
-- On Supabase, tables in the public schema are reachable through the auto-generated REST API
-- with the public (publishable) key. The app talks to Postgres directly as the owner role, which
-- bypasses RLS, so enabling RLS with NO policies closes the REST door without affecting the app.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS schema_migrations ENABLE ROW LEVEL SECURITY;

-- ===== storage bucket (private) =====
INSERT INTO storage.buckets (id, name, public)
VALUES ('dbi', 'dbi', false)
ON CONFLICT (id) DO NOTHING;

-- ===== migration bookkeeping (lets `npm run db:migrate` continue from here) =====
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations (name) VALUES
  ('001_init.sql'), ('002_organizations.sql'), ('003_dashboard_sections.sql'),
  ('004_branding.sql'), ('005_platform_admin.sql'), ('006_enable_rls.sql')
ON CONFLICT DO NOTHING;

COMMIT;
