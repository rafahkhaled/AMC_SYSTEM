-- The EmaraTax credential vault (FR-05).
--
-- A tax agent holds their clients' logins to the federal portal. That is the
-- most sensitive data in this system: with it somebody can file, amend or
-- deregister on a company's behalf. Three things follow, and all three are
-- enforced here rather than left to the code above.
--
-- 1. The secret is never stored in a readable form. Only the sealed value is
--    a column; there is no plaintext column to accidentally select.
-- 2. Reading one is an event. The application reaches secrets through a vault
--    that writes the audit row before it returns the plaintext, so a read that
--    could not be logged does not happen. This table does not hold a "last
--    read" column, because the log is the record and a column would be a
--    second version of it that could disagree.
-- 3. One live credential of each kind per client, so nobody has to guess
--    which of two is current.

CREATE TABLE client_credentials (
  id             text        PRIMARY KEY,
  client_id      text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,

  -- What it opens. EmaraTax is the one that matters; the others are here so a
  -- practice does not keep the rest in a spreadsheet beside it.
  kind           text        NOT NULL,
  -- Shown freely: knowing the username is not knowing the password, and
  -- hiding it would mean opening the secret just to tell two entries apart.
  username       text        NOT NULL,
  -- Sealed with the envelope cipher. Base64 of nonce, key id and ciphertext.
  secret_sealed  text        NOT NULL,
  -- Anything that is not a secret: which emirate's portal, a security answer
  -- hint, who at the client set it up.
  note           text,

  -- Retired rather than deleted, because an audit asks who could have filed
  -- last March and a deleted row cannot answer.
  retired_at     timestamptz,
  retired_by     text        REFERENCES users (id) ON DELETE SET NULL,

  created_by     text        REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_credentials_kind_known CHECK (kind IN (
    'emaratax', 'ftaportal', 'bank_portal', 'other'
  )),
  CONSTRAINT client_credentials_username_present CHECK (length(btrim(username)) > 0),
  CONSTRAINT client_credentials_secret_present CHECK (length(btrim(secret_sealed)) > 0),
  CONSTRAINT client_credentials_retired_together CHECK (
    (retired_at IS NULL) = (retired_by IS NULL)
  )
);

-- One live credential of each kind per client. Retired ones are excluded, so
-- replacing a password does not trip over the entry it replaces.
CREATE UNIQUE INDEX client_credentials_current_idx
  ON client_credentials (client_id, kind)
  WHERE retired_at IS NULL;

CREATE INDEX client_credentials_client_idx ON client_credentials (client_id);

CREATE TRIGGER client_credentials_updated_at BEFORE UPDATE ON client_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN client_credentials.secret_sealed IS
  'Envelope-encrypted. There is deliberately no plaintext column: a SELECT * must not be able to leak a password.';
