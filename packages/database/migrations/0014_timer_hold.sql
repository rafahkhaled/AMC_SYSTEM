-- Holding a timer (FR-21).
--
-- A hold is not a third state that has to be reconciled later. The span up to
-- the hold is recorded as an ordinary entry there and then, and resuming
-- starts a fresh span. A day's total is the sum of its entries either way, so
-- held time is simply absent from the sum rather than subtracted from it —
-- there is no accumulated-pause figure to drift out of step with the entries.
--
-- The row survives the hold so the screen still knows whose timer it is and
-- what it was on. That is the whole reason this is not just "stop".

ALTER TABLE running_timers
  ADD COLUMN held_at timestamptz;

-- While held there is no open span, so started_at says when the *next* span
-- would begin and carries no meaning until the hold is lifted. The check keeps
-- the two from being written in an order that could not have happened.
ALTER TABLE running_timers
  ADD CONSTRAINT running_timers_held_after_start CHECK (held_at IS NULL OR held_at >= started_at);

COMMENT ON COLUMN running_timers.held_at IS
  'Set while the timer is held. The span up to this instant is already recorded as a time entry.';

-- The sweep for abandoned timers should not pick up held ones: a held timer
-- has no open span, so there is nothing to trim and nothing at risk.
DROP INDEX IF EXISTS running_timers_stale_idx;
CREATE INDEX running_timers_stale_idx ON running_timers (last_seen_at) WHERE held_at IS NULL;
