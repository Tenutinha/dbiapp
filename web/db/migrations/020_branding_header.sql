-- Colour of the fixed bar on top of the dashboard area (dashboard · topic) per space. NULL = the colour
-- of the cards; set = the bar takes it and its text is derived for contrast (src/lib/theme/theme.ts).
ALTER TABLE space_branding ADD COLUMN IF NOT EXISTS header_color text
  CHECK (header_color ~ '^#[0-9a-f]{6}$');
