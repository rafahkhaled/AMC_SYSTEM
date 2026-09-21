-- Statements of work done (P2-03, P2-04, FR-31, FR-32).
--
-- Approved, unbilled, billable hours priced at the rate that applied on the day
-- the work was done. That is the reason client rates are effective-dated: a
-- firm that raises its rate in March and bills February at the new one has
-- overcharged, and the client's own record of the engagement will say so.
--
-- A statement is a review document before it is a bill. Lines can be excluded
-- or adjusted and neither is possible without a reason, because the question
-- asked afterwards is never "what did we charge" but "why is this line not
-- what the timesheet says".

CREATE TABLE statements (
  id           text        PRIMARY KEY,
  client_id    text        NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,

  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  state        text        NOT NULL DEFAULT 'draft',
  currency     text        NOT NULL DEFAULT 'AED',

  created_by   text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  approved_at  timestamptz,
  approved_by  text        REFERENCES users (id) ON DELETE RESTRICT,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT statements_state_known CHECK (
    state IN ('draft', 'approved', 'invoiced', 'cancelled')
  ),
  CONSTRAINT statements_period_ordered CHECK (period_end >= period_start),
  -- Approved by somebody, at a time, or neither. "It was approved" with no
  -- name against it is the record nobody can act on.
  CONSTRAINT statements_approval_complete CHECK (
    (approved_at IS NULL) = (approved_by IS NULL)
  ),
  CONSTRAINT statements_approved_states_have_approval CHECK (
    state NOT IN ('approved', 'invoiced') OR approved_at IS NOT NULL
  )
);

CREATE INDEX statements_client_idx ON statements (client_id, period_end DESC);
CREATE INDEX statements_created_by_idx ON statements (created_by);
CREATE INDEX statements_approved_by_idx ON statements (approved_by) WHERE approved_by IS NOT NULL;
-- What is waiting to be reviewed, and what is ready to invoice.
CREATE INDEX statements_open_idx ON statements (state, period_end DESC)
  WHERE state IN ('draft', 'approved');

CREATE TRIGGER statements_updated_at BEFORE UPDATE ON statements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * The lines.
 *
 * One per task, day and person — the grouping a client can check against their
 * own diary. `task_id` is NOT NULL and stays that way: nothing bills without a
 * task (ERD rule 4), and it is this column that makes an invoice defensible
 * three years later when somebody asks what a line was for.
 *
 * The rate is stored on the line rather than looked up on read. The client's
 * rate will change; what they were billed must not.
 */
CREATE TABLE statement_lines (
  id                 text        PRIMARY KEY,
  statement_id       text        NOT NULL REFERENCES statements (id) ON DELETE CASCADE,
  task_id            text        NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  service            text        NOT NULL,
  -- The day the work was done, which is what chose the rate.
  performed_on       date        NOT NULL,
  -- Who did it. Nullable only because a person can be removed; the line is a
  -- record of what happened, not of who currently works here.
  user_id            text        REFERENCES users (id) ON DELETE SET NULL,

  worked_seconds     integer     NOT NULL,
  per_hour_minor     bigint      NOT NULL,

  excluded           boolean     NOT NULL DEFAULT false,
  excluded_reason    text,
  adjusted_to_minor  bigint,
  adjusted_reason    text,

  position           integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT statement_lines_worked_positive CHECK (worked_seconds > 0),
  CONSTRAINT statement_lines_rate_not_negative CHECK (per_hour_minor >= 0),
  CONSTRAINT statement_lines_adjusted_not_negative CHECK (
    adjusted_to_minor IS NULL OR adjusted_to_minor >= 0
  ),
  -- Neither change is possible without a reason. This is the constraint that
  -- makes "why is this line not what the timesheet says" answerable.
  CONSTRAINT statement_lines_exclusion_explained CHECK (
    excluded = false OR length(btrim(coalesce(excluded_reason, ''))) >= 3
  ),
  CONSTRAINT statement_lines_adjustment_explained CHECK (
    adjusted_to_minor IS NULL OR length(btrim(coalesce(adjusted_reason, ''))) >= 3
  ),
  CONSTRAINT statement_lines_one_position UNIQUE (statement_id, position)
);

CREATE INDEX statement_lines_statement_idx ON statement_lines (statement_id, position);
CREATE INDEX statement_lines_task_idx ON statement_lines (task_id);
CREATE INDEX statement_lines_user_idx ON statement_lines (user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER statement_lines_updated_at BEFORE UPDATE ON statement_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * The loop P1 left open.
 *
 * `time_entries.statement_line_id` has been a bare text column since migration
 * 0011, waiting for this table to exist. Adding the key now is what stops an
 * entry pointing at a line that was deleted, which would leave hours that are
 * frozen — the trigger refuses to edit them — and attached to nothing, so no
 * statement will ever pick them up again. Invisible, unbillable, and only
 * discovered when somebody adds up a year.
 *
 * ON DELETE SET NULL: deleting a draft statement releases its hours back to
 * the unbilled pool, which is exactly what cancelling one should do.
 */
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_statement_line_fk
  FOREIGN KEY (statement_line_id) REFERENCES statement_lines (id) ON DELETE SET NULL;

CREATE INDEX time_entries_statement_line_idx ON time_entries (statement_line_id)
  WHERE statement_line_id IS NOT NULL;

COMMENT ON TABLE statements IS
  'Approved unbilled hours priced at the rate that applied the day they were worked. A review document before it is a bill.';
COMMENT ON TABLE statement_lines IS
  'One line per task, day and person. task_id is never null: nothing bills without a task.';
