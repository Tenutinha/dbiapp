-- A person's avatar (header menu, profile, access lists). The file lives in storage at
-- users/<user id>/avatar/<avatar_key>.<ext>; avatar_key is the public, unguessable URL id
-- (/api/users/avatar/<avatar_key>), replaced on every upload.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key uuid UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime text CHECK (avatar_mime IN ('image/png', 'image/jpeg', 'image/webp'));
