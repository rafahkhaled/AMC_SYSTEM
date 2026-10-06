/*
 * A due date for each step, not only for the work (FR-11).
 *
 * A VAT return due on the 28th is one date and one piece of information. The
 * step that matters a fortnight earlier — "documents from the client" — had
 * no date at all, so the only way to know a project was drifting was to
 * notice that the final deadline had become uncomfortably close.
 *
 * Null by default and null for most steps. A template gives dates to the ones
 * worth chasing; the rest are simply done in order.
 */
ALTER TABLE tasks
  ADD COLUMN due_on date;

COMMENT ON COLUMN tasks.due_on IS
  'When this step should be finished. Null where only the project deadline matters.';
