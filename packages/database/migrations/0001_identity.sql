-- Identity: who may sign in, what they may do, and which sessions are live.

CREATE TABLE users (
  id              text        PRIMARY KEY,
  email           citext      NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  password_hash   text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active',
  totp_secret     text,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_status_known CHECK (status IN ('active', 'suspended')),
  CONSTRAINT users_failed_attempts_sane CHECK (failed_attempts >= 0),
  CONSTRAINT users_display_name_present CHECK (length(btrim(display_name)) > 0)
);

CREATE INDEX users_status_idx ON users (status);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN users.email IS
  'citext, so two spellings of one inbox cannot become two accounts (SRS 2.2).';

-- Roles are rows rather than an array, so a person can hold more than one and
-- so a role can be granted or revoked without rewriting the user.
CREATE TABLE user_roles (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role    text NOT NULL,

  PRIMARY KEY (user_id, role),
  CONSTRAINT user_roles_known CHECK (role IN ('manager', 'accountant', 'data_entry', 'client'))
);

-- A session id is a ULID and therefore guessable, so it names a session but
-- never authorises one. The secret does that, and only its hash is stored:
-- a leaked backup hands over no live sessions.
CREATE TABLE sessions (
  id                  text        PRIMARY KEY,
  user_id             text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash          text        NOT NULL,
  created_at          timestamptz NOT NULL,
  last_seen_at        timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  idle_minutes        integer     NOT NULL,
  ip_address          text,
  user_agent          text,
  two_factor_passed   boolean     NOT NULL DEFAULT false,

  CONSTRAINT sessions_idle_positive CHECK (idle_minutes > 0),
  CONSTRAINT sessions_absolute_after_creation CHECK (absolute_expires_at > created_at),
  CONSTRAINT sessions_last_seen_not_before_creation CHECK (last_seen_at >= created_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_absolute_expiry_idx ON sessions (absolute_expires_at);

COMMENT ON TABLE sessions IS
  'Two expiries by design (NFR-04): idle covers the abandoned laptop, absolute covers the session kept alive by polling.';
