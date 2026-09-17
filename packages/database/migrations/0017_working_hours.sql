-- Each person's working hours, and the time entries that fall outside them
-- (FR-25).
--
-- Two different failures are being prevented, and they look alike on a
-- timesheet. One is a timer left running: somebody starts a task at four, goes
-- home, and the clock reads fourteen hours on Monday. The other is real work
-- done late, which is ordinary in a practice during filing season and must not
-- be thrown away.
--
-- Neither can be told apart automatically, so nothing is discarded and nothing
-- is billed quietly. The entry is recorded, flagged, and shown to the person
-- who made it.

CREATE TABLE user_working_hours (
  user_id      text        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Local time in Dubai, which is where the working day is. Stored as a time
  -- rather than an instant because "nine in the morning" is not a moment.
  starts_at    time        NOT NULL DEFAULT '09:00',
  ends_at      time        NOT NULL DEFAULT '18:00',
  -- ISO weekday numbers: 1 is Monday, 7 is Sunday. An array rather than seven
  -- columns, because somebody working Sunday to Thursday is normal here and a
  -- column per day makes that a schema change.
  working_days smallint[]  NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::smallint[],

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_working_hours_day_ends_after_it_starts CHECK (ends_at > starts_at),
  CONSTRAINT user_working_hours_days_present CHECK (
    array_length(working_days, 1) BETWEEN 1 AND 7
  ),
  CONSTRAINT user_working_hours_days_valid CHECK (
    working_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  )
);

CREATE TRIGGER user_working_hours_updated_at BEFORE UPDATE ON user_working_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Why an entry is waiting to be confirmed.
 *
 * Null means nothing is in doubt. A flagged entry is still a real entry — it
 * counts on a timesheet and is visible to its owner — but it cannot be
 * approved for billing until somebody has looked at it, which the billing
 * phase will enforce.
 */
ALTER TABLE time_entries
  ADD COLUMN review_reason text,
  ADD COLUMN reviewed_at   timestamptz,
  ADD COLUMN reviewed_by   text REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_review_reason_known CHECK (
    review_reason IS NULL OR review_reason IN ('after_hours', 'abandoned', 'implausible')
  ),
  ADD CONSTRAINT time_entries_reviewed_together CHECK (
    (reviewed_at IS NULL) = (reviewed_by IS NULL)
  ),
  -- Confirming something nobody questioned is meaningless, and would let a
  -- reviewed_at appear on entries that were never flagged.
  ADD CONSTRAINT time_entries_reviewed_only_if_flagged CHECK (
    reviewed_at IS NULL OR review_reason IS NOT NULL
  );

-- The question the screen asks: what of mine is still waiting on me?
CREATE INDEX time_entries_awaiting_review_idx
  ON time_entries (assignment_id)
  WHERE review_reason IS NOT NULL AND reviewed_at IS NULL;

COMMENT ON COLUMN time_entries.review_reason IS
  'Why this entry needs a second look. Null means nothing is in doubt.';
