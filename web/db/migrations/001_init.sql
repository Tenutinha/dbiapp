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
