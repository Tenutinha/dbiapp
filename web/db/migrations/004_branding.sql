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
