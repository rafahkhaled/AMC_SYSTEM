-- Invoices and payments (P2-05 to P2-09, FR-32, FR-33).
--
-- Raised from an approved statement and frozen at that moment. The lines are
-- copies rather than references: the statement can be reopened, a rate can
-- change, a task can be renamed, and none of it may alter a document the
-- client has already been sent.

/*
 * The invoice sequence.
 *
 * Gapless and allocated exactly once, which is a database's job. A number
 * handed out twice puts two documents in a client's file under one reference;
 * a gap invites a question from an auditor that nobody can answer afterwards.
 *
 * Per year, because that is how the firm and everybody auditing it counts.
 */
CREATE TABLE invoice_numbers (
  year       integer     PRIMARY KEY,
  next_value integer     NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_numbers_positive CHECK (next_value > 0)
);

CREATE TABLE invoices (
  id                text        PRIMARY KEY,
  client_id         text        NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  -- RESTRICT: a statement that has been billed cannot be deleted out from
  -- under the invoice that explains it.
  statement_id      text        NOT NULL REFERENCES statements (id) ON DELETE RESTRICT,

  number            text        NOT NULL,
  settlement        text        NOT NULL DEFAULT 'issued',
  currency          text        NOT NULL DEFAULT 'AED',

  -- Basis points. 500 is the UAE's five percent, 0 for a firm that is not
  -- registered. Stored here rather than looked up, because the rate that
  -- applied when it was issued is the rate that stays on it.
  vat_basis_points  integer     NOT NULL DEFAULT 0,

  issued_on         timestamptz NOT NULL,
  due_on            timestamptz NOT NULL,
  /*
   * When it became late, not whether it is.
   *
   * Separate from settlement because an invoice can be part paid *and* two
   * weeks late, and one status field forces a choice between recording the
   * payment or the lateness. The follow-up ladder counts days from this date,
   * which is why the sweep must not reset it each morning.
   */
  overdue_since     timestamptz,

  issued_by         text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  notes_en          text,
  notes_ar          text,
  cancelled_reason  text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoices_settlement_known CHECK (
    settlement IN ('issued', 'part_paid', 'paid', 'cancelled')
  ),
  CONSTRAINT invoices_number_present CHECK (length(btrim(number)) > 0),
  CONSTRAINT invoices_due_after_issue CHECK (due_on >= issued_on),
  CONSTRAINT invoices_vat_sane CHECK (vat_basis_points BETWEEN 0 AND 10000),
  -- Settled and cancelled invoices are not late.
  CONSTRAINT invoices_settled_not_overdue CHECK (
    settlement NOT IN ('paid', 'cancelled') OR overdue_since IS NULL
  ),
  CONSTRAINT invoices_cancellation_explained CHECK (
    settlement <> 'cancelled' OR length(btrim(coalesce(cancelled_reason, ''))) >= 3
  )
);

-- One document per reference, always.
CREATE UNIQUE INDEX invoices_number_idx ON invoices (number);
CREATE INDEX invoices_client_idx ON invoices (client_id, issued_on DESC);
CREATE INDEX invoices_statement_idx ON invoices (statement_id);
CREATE INDEX invoices_issued_by_idx ON invoices (issued_by);
-- What the overdue sweep asks each morning, and what the receivables list shows.
CREATE INDEX invoices_outstanding_idx ON invoices (due_on)
  WHERE settlement IN ('issued', 'part_paid');

CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_lines (
  id             text        PRIMARY KEY,
  invoice_id     text        NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  -- Never null, and RESTRICT. Nothing bills without a task (ERD rule 4), and a
  -- task deleted out from under a billed line would leave a charge nobody can
  -- account for.
  task_id        text        NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  service        text        NOT NULL,

  -- What the client reads. Written at issue, in both languages, and never
  -- recomputed: the document in their file has to keep saying what it said.
  description_en text        NOT NULL,
  description_ar text        NOT NULL,

  worked_seconds integer     NOT NULL,
  amount_minor   bigint      NOT NULL,

  position       integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invoice_lines_amount_not_negative CHECK (amount_minor >= 0),
  CONSTRAINT invoice_lines_worked_not_negative CHECK (worked_seconds >= 0),
  CONSTRAINT invoice_lines_one_position UNIQUE (invoice_id, position)
);

CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id, position);
CREATE INDEX invoice_lines_task_idx ON invoice_lines (task_id);

/*
 * Payments (FR-33).
 *
 * Several per invoice, because a client paying half now and half when their
 * own receivable lands is the ordinary case. A system that only understands
 * paid-or-not makes somebody keep the difference in their head.
 */
CREATE TABLE payments (
  id           text        PRIMARY KEY,
  invoice_id   text        NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  amount_minor bigint      NOT NULL,
  currency     text        NOT NULL DEFAULT 'AED',
  received_on  timestamptz NOT NULL,
  method       text        NOT NULL,
  reference    text,
  recorded_by  text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_positive CHECK (amount_minor > 0),
  CONSTRAINT payments_method_known CHECK (
    method IN ('bank_transfer', 'cheque', 'cash', 'card', 'other')
  )
);

CREATE INDEX payments_invoice_idx ON payments (invoice_id, received_on);
CREATE INDEX payments_recorded_by_idx ON payments (recorded_by);

COMMENT ON TABLE invoices IS
  'Raised from an approved statement and frozen. overdue_since is separate from settlement so an invoice can be part paid and late at once.';
COMMENT ON TABLE invoice_lines IS
  'Copies, not references. task_id is never null: nothing bills without a task.';
COMMENT ON TABLE payments IS
  'Money received against an invoice. Several per invoice; partial payment is the ordinary case.';
COMMENT ON TABLE invoice_numbers IS
  'The gapless per-year invoice sequence. Allocated by the database because a number handed out twice cannot be undone.';
