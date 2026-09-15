-- The audit log (NFR-05) and the transactional outbox.
--
-- Both are written inside the same transaction as the change they describe, so
-- a committed change cannot exist without its audit row, and an event cannot
-- be published for a change that was rolled back.

CREATE TABLE audit_log (
  id            text        PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- Deliberately not a foreign key. The log outlives the people in it, and a
  -- cascade would be an UPDATE or DELETE on a table that permits neither.
  actor_user_id text,
  actor_roles   text[]      NOT NULL DEFAULT '{}',
  actor_label   text,

  action        text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     text        NOT NULL,
  before        jsonb,
  after         jsonb,

  ip_address    text,
  request_id    text,
  session_id    text,

  CONSTRAINT audit_log_action_present CHECK (length(btrim(action)) > 0),
  CONSTRAINT audit_log_entity_present CHECK (length(btrim(entity_type)) > 0)
);

CREATE INDEX audit_log_entity_idx   ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx    ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_action_idx   ON audit_log (action, occurred_at DESC);

/*
 * Append-only, enforced by the database rather than by good intentions.
 *
 * A production deployment additionally connects as a role holding only INSERT
 * and SELECT here. This trigger is the belt to that pair of braces: it holds
 * even when someone is connected as the owner, which is how a local console or
 * an incident-time psql session actually reaches a table.
 */
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING HINT = 'Corrections are recorded as new entries, never by editing an old one.';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

COMMENT ON TABLE audit_log IS
  'Append-only record of every create, edit, approval, export and access to sensitive data (NFR-05).';

-- The outbox. Events are written with the change and delivered afterwards, so
-- delivery is at-least-once and never describes something that did not happen.
CREATE TABLE outbox (
  id            text        PRIMARY KEY,
  occurred_at   timestamptz NOT NULL,
  name          text        NOT NULL,
  aggregate_id  text        NOT NULL,
  payload       jsonb       NOT NULL,
  published_at  timestamptz,
  attempts      integer     NOT NULL DEFAULT 0,
  last_error    text,

  CONSTRAINT outbox_attempts_sane CHECK (attempts >= 0)
);

-- Partial index: the only query that matters is "what is still unpublished",
-- and a partial index keeps it small however large the table grows.
CREATE INDEX outbox_pending_idx ON outbox (occurred_at) WHERE published_at IS NULL;
