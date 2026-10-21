-- Forgotten passwords.
--
-- A person who cannot sign in asks for a link by email. The link carries a
-- random token and the database holds only a hash of it, like sessions: a
-- stolen backup hands over no working links. A token is good for one hour and
-- one use, and asking again voids the one before.
CREATE TABLE password_resets (
  id           text        PRIMARY KEY,
  user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  -- Where the request came from, for the person who later asks "was that me?".
  requested_ip text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;

COMMENT ON TABLE password_resets IS
  'Password reset links: hashed token, one hour, one use. Asking again voids earlier unused ones.';
