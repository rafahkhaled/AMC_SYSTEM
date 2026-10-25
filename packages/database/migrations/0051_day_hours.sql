-- Different hours on some days (feedback: "change Saturday's timing").
--
-- One start and end for the whole week did not fit a firm whose Saturday is
-- shorter. A day listed here has its own hours; every other working day keeps
-- the usual ones. Keyed by ISO weekday, "6" for Saturday.
ALTER TABLE user_working_hours
  ADD COLUMN day_hours jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_working_hours.day_hours IS
  'Per-weekday overrides, {"6": {"startsAt": "09:00", "endsAt": "14:00"}}. Days not listed use starts_at/ends_at.';
