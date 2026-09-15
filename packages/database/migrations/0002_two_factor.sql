-- Two-factor authentication.
--
-- The secret is stored sealed, never in the clear: a secret in a plain column
-- would let anyone reading a database backup generate valid codes for every
-- account in it, which defeats the entire purpose of a second factor.
ALTER TABLE users
  ADD COLUMN totp_confirmed_at timestamptz;

COMMENT ON COLUMN users.totp_secret IS
  'AES-256-GCM sealed. Null until enrolment starts; see SecretBox.';
COMMENT ON COLUMN users.totp_confirmed_at IS
  'Null until a code has been produced from the secret. An abandoned enrolment must never lock anyone out.';

-- A secret that has been confirmed must exist.
ALTER TABLE users
  ADD CONSTRAINT users_totp_confirmed_needs_secret
  CHECK (totp_confirmed_at IS NULL OR totp_secret IS NOT NULL);
