-- What the file explorer learned from each stored file: its layout (fiscal identity, CSV/Parquet columns…),
-- read once from the file's first bytes. Kept per object key; a new analysis replaces it when the file
-- changes (size or modification date differ). The verdict (ready / needs treatment) is not stored: it is
-- worked out on every view against the space's current dashboards.
CREATE TABLE IF NOT EXISTS storage_file_analysis (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL,
  file_updated_at timestamptz,
  facts jsonb NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, storage_key)
);

-- Closed to Supabase's REST API like every other table (the app connects as the owner; see 006).
ALTER TABLE storage_file_analysis ENABLE ROW LEVEL SECURITY;
