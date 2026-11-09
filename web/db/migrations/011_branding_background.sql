-- Background of the dashboard area (behind the cards) per space. NULL = the light/dark appearance's
-- own background; set = cards, lines and text are derived from it (src/lib/theme/theme.ts).
ALTER TABLE space_branding ADD COLUMN IF NOT EXISTS background_color text
  CHECK (background_color ~ '^#[0-9a-f]{6}$');
