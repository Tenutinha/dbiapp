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
