-- Foundation migration. No business tables yet: this establishes the
-- conventions every later table depends on, so they are decided once.

-- gen_random_uuid() for request ids and anything that does not need to sort.
-- Business identifiers are ULIDs generated in the application, so that an
-- aggregate and the events it records share one id before the insert happens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Case-insensitive text, for email addresses and tax registration numbers,
-- where "A@B.com" and "a@b.com" must never become two different clients.
CREATE EXTENSION IF NOT EXISTS citext;

-- Accent- and case-insensitive search over Arabic and English client names.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Every table carries created_at and updated_at. This keeps updated_at honest
-- even when a row is changed by a migration or by hand during an incident,
-- rather than trusting every write path to remember.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Attach with: CREATE TRIGGER <table>_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();';

-- Timestamps are stored in UTC without exception. Business rules convert to
-- Asia/Dubai through the Clock port, never through the database session.
SET TIME ZONE 'UTC';
