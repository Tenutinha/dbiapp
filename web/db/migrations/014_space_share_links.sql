-- Public link of a whole space (the organization's own, or one client's): anyone with /l/<token> sees the
-- space's published dashboards, read-only, without an account. Set up by org admins in the admin's
-- "Acessos" column; one active link per space (a new one revokes the previous), optional expiry.
CREATE TABLE IF NOT EXISTS space_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL = the organization's own space.
  client_id uuid REFERENCES org_clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS space_share_links_space_idx ON space_share_links (organization_id, client_id);

-- Closed to Supabase's REST API like every other table (the app connects as the owner; see 006).
ALTER TABLE space_share_links ENABLE ROW LEVEL SECURITY;
