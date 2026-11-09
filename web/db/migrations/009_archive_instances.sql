-- "Desvincular" a dashboard from an organization or client archives it instead of deleting:
-- it disappears from viewing, the sidebar and the lists, but its data versions and files stay,
-- and linking the same dashboard to the same space again brings everything back.
ALTER TABLE dashboard_instances ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Lists and the sidebar only read linked (not archived) dashboards of a space.
CREATE INDEX IF NOT EXISTS dashboard_instances_linked_idx
  ON dashboard_instances (organization_id, client_id)
  WHERE archived_at IS NULL;
