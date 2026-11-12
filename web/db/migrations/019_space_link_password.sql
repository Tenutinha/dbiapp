-- Optional password on a space's public link (/l/<token>). Only a salted scrypt hash is kept
-- ("scrypt$<salt>$<hash>"); NULL = no password. Wrong attempts are counted per link and lock it for a
-- while after too many in a row (see web/src/lib/link-password.ts).
ALTER TABLE space_share_links
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;
