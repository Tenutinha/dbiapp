-- Platform administrators ("admin master"): full access to every organization and client,
-- and the only ones who can create organizations.
ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;
