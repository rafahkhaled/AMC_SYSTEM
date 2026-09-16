-- Recorded time, and the one timer a person may have running.

CREATE TABLE time_entries (
  id               text        PRIMARY KEY,
  -- The assignment, not the task and not the person. Client, task and staff
  -- are all reached through it, so a later reassignment cannot rewrite who did
  -- this work (FR-20).
  assignment_id    text        NOT NULL REFERENCES task_assignments (id) ON DELETE RESTRICT,

  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  -- Stored rather than computed on read, so a timesheet is a sum rather than a
  -- calculation repeated a thousand times.
  duration_seconds integer GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NULL THEN 0
         ELSE GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::integer)
    END
  ) STORED,

  source           text        NOT NULL DEFAULT 'timer',
  reason           text,
  billable         boolean     NOT NULL DEFAULT true,
  note             text,

  approved_at      timestamptz,
  approved_by      text,
  -- Set when the entry reaches a statement. From then on it is frozen (FR-26).
  statement_line_id text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT time_entries_source_known CHECK (source IN ('timer', 'manual')),
  CONSTRAINT time_entries_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- Manual time says why it was entered by hand (FR-22).
  CONSTRAINT time_entries_manual_has_reason CHECK (
    source <> 'manual' OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)
  ),
  CONSTRAINT time_entries_approved_together CHECK (
    (approved_at IS NULL) = (approved_by IS NULL)
  ),
  -- Only approved time can be billed.
  CONSTRAINT time_entries_billed_was_approved CHECK (
    statement_line_id IS NULL OR approved_at IS NOT NULL
  )
);

CREATE INDEX time_entries_assignment_idx ON time_entries (assignment_id, started_at DESC);
-- The billing question: which approved hours are not yet on a statement?
CREATE INDEX time_entries_unbilled_idx ON time_entries (approved_at)
  WHERE statement_line_id IS NULL AND billable AND ended_at IS NOT NULL;

CREATE TRIGGER time_entries_updated_at BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Invoiced time cannot be edited (FR-26).
 *
 * The domain refuses it already. This refuses it again at the database, because
 * what makes a client statement defensible is that the hours behind it cannot
 * quietly change after it was sent, and "the application will not do that" is a
 * weaker promise than "the database will not allow it".
 *
 * Releasing is the one permitted change, and it is a manager action recorded in
 * the audit log.
 */
CREATE OR REPLACE FUNCTION time_entries_stay_put() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.statement_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Releasing from the statement.
  IF NEW.statement_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
     OR NEW.billable IS DISTINCT FROM OLD.billable
     OR NEW.source   IS DISTINCT FROM OLD.source
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
  THEN
    RAISE EXCEPTION 'This time is on a statement and cannot be changed'
      USING HINT = 'Release it from the statement first; that is a manager action and is recorded.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER time_entries_locked_when_billed
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entries_stay_put();

/*
 * One timer per person (FR-21).
 *
 * The person is the primary key, which is the constraint rather than a rule
 * the application remembers. Starting a second timer replaces the row, and the
 * first is recorded as an entry in the same transaction.
 */
CREATE TABLE running_timers (
  user_id       text        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  assignment_id text        NOT NULL REFERENCES task_assignments (id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL,
  device_id     text,
  -- Last sign of life. A timer with an old heartbeat was abandoned, and is
  -- trimmed back to this rather than billing the intervening night (FR-25).
  last_seen_at  timestamptz NOT NULL,

  CONSTRAINT running_timers_seen_after_start CHECK (last_seen_at >= started_at)
);

CREATE INDEX running_timers_stale_idx ON running_timers (last_seen_at);

COMMENT ON TABLE running_timers IS
  'At most one row per person, by primary key. FR-21 as a constraint rather than a convention.';
