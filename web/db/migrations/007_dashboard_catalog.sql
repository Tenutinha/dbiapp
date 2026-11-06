-- Dashboard catalog: ready-made dashboards that organizations can activate.
-- Platform admins register them (template JSON = data contract + measures + layout);
-- organizations only see the published ones. Templates shipped in web/templates are
-- synced here on startup as built-in entries (their definition stays code-reviewed).

CREATE TYPE template_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE dashboard_templates (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,60}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  area         text NOT NULL CHECK (char_length(area) BETWEEN 1 AND 80),
  origin       text NOT NULL CHECK (origin IN ('powerbi', 'qlikview')),
  description  text NOT NULL CHECK (char_length(description) <= 2000),
  version      integer NOT NULL CHECK (version >= 1),
  -- Full template, validated by the app (src/lib/templates/schema.ts) before every write.
  definition   jsonb NOT NULL CHECK (pg_column_size(definition) <= 512 * 1024),
  status       template_status NOT NULL DEFAULT 'draft',
  -- Shipped in web/templates: definition is managed by code, only status is editable.
  built_in     boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dashboard_templates_status_idx ON dashboard_templates(status);

-- Same as every other table: the app connects as owner (bypasses RLS); no policies closes the
-- public REST API (see 006_enable_rls.sql).
ALTER TABLE dashboard_templates ENABLE ROW LEVEL SECURITY;
