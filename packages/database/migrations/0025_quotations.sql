-- Quotations (P2-01, FR-30).
--
-- What the firm offered a client before any work existed. Deliberately not a
-- step on the way to an invoice: work happens in between, hours are recorded
-- against a task, and what is eventually billed is the statement of that work.
-- A quotation that converted directly into an invoice would let the practice
-- bill for work nobody did, which is what the ERD's "no invoice without a task"
-- rule exists to stop.

CREATE TABLE quotations (
  id          text        PRIMARY KEY,
  -- RESTRICT, not CASCADE. Deleting a client who has been quoted would erase
  -- the evidence of what they were offered, and that is exactly the record
  -- somebody wants when a price is disputed a year later.
  client_id   text        NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,

  -- What the client quotes back on the phone.
  reference   text        NOT NULL,
  state       text        NOT NULL DEFAULT 'draft',
  currency    text        NOT NULL DEFAULT 'AED',

  valid_until date,
  sent_at     timestamptz,
  decided_at  timestamptz,

  notes_en    text,
  notes_ar    text,

  created_by  text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quotations_state_known CHECK (
    state IN ('draft', 'sent', 'accepted', 'declined', 'expired')
  ),
  CONSTRAINT quotations_reference_present CHECK (length(btrim(reference)) > 0),

  -- A draft has not been sent, and anything else has. Without this, a row can
  -- claim to be with the client while carrying no date it went out on, and the
  -- follow-up list then has nothing to count days from.
  CONSTRAINT quotations_sent_when_not_draft CHECK (
    (state = 'draft') = (sent_at IS NULL)
  ),
  -- An answer has a date. "They accepted it at some point" is not a record.
  CONSTRAINT quotations_decided_when_answered CHECK (
    (state IN ('accepted', 'declined')) = (decided_at IS NOT NULL)
  ),
  -- Expiring needs a date to have passed, so one without a date cannot expire.
  CONSTRAINT quotations_expired_had_a_date CHECK (
    state <> 'expired' OR valid_until IS NOT NULL
  )
);

-- The reference is what a client says on the phone; two quotations answering
-- to the same one is a conversation nobody can resolve.
CREATE UNIQUE INDEX quotations_reference_idx ON quotations (reference);
CREATE INDEX quotations_client_idx ON quotations (client_id, created_at DESC);
CREATE INDEX quotations_created_by_idx ON quotations (created_by);
-- The sweep that expires them, and the screen that lists what is outstanding.
CREATE INDEX quotations_awaiting_idx ON quotations (valid_until)
  WHERE state = 'sent';

CREATE TRIGGER quotations_updated_at BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * The lines.
 *
 * Two shapes, and which one was offered matters after the fact: a fixed fee
 * accepted at 5,000 is still 5,000 when the work runs long, and an hourly
 * estimate is not. Storing them in one table with a discriminator keeps a
 * quotation's lines in one order and one place; the check constraints are what
 * stop a row being half of each.
 */
CREATE TABLE quotation_lines (
  id             text        PRIMARY KEY,
  quotation_id   text        NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
  -- The order the firm wrote them in, which is the order the client reads.
  position       integer     NOT NULL,

  description_en text,
  description_ar text,

  kind           text        NOT NULL,
  -- Hundredths of an hour, as a whole number. "3.5 hours" is 350. No floating
  -- point touches the billing path (ADR-0003), and that includes the quantity
  -- and not only the money.
  hours_centi    integer,
  per_hour_minor bigint,
  amount_minor   bigint,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quotation_lines_kind_known CHECK (kind IN ('hours', 'fixed')),
  CONSTRAINT quotation_lines_hours_complete CHECK (
    (kind = 'hours') = (hours_centi IS NOT NULL AND per_hour_minor IS NOT NULL)
  ),
  CONSTRAINT quotation_lines_fixed_complete CHECK (
    (kind = 'fixed') = (amount_minor IS NOT NULL)
  ),
  CONSTRAINT quotation_lines_hours_positive CHECK (hours_centi IS NULL OR hours_centi > 0),
  CONSTRAINT quotation_lines_not_negative CHECK (
    (per_hour_minor IS NULL OR per_hour_minor >= 0)
    AND (amount_minor IS NULL OR amount_minor >= 0)
  ),
  -- Described in at least one language. A line with no words is a number the
  -- client cannot argue with because they cannot tell what it is for.
  CONSTRAINT quotation_lines_described CHECK (
    length(btrim(coalesce(description_en, ''))) > 0
    OR length(btrim(coalesce(description_ar, ''))) > 0
  ),
  CONSTRAINT quotation_lines_one_position UNIQUE (quotation_id, position)
);

CREATE INDEX quotation_lines_quotation_idx ON quotation_lines (quotation_id, position);

COMMENT ON TABLE quotations IS
  'What the firm offered a client before any work existed. Never becomes an invoice; the statement of work does.';
COMMENT ON TABLE quotation_lines IS
  'Quotation lines, priced by estimated hours or as a fixed fee. hours_centi is hundredths of an hour, whole.';
