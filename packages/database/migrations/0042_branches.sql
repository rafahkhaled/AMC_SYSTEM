-- Branches (feedback item 12b).
--
-- A quotation or an invoice goes out under one of the firm's branches — Dubai,
-- Ajman — and the printed document takes that branch's letterhead: its name and
-- address, and where the branch has its own, its bank details, logo and stamp.
--
-- A branch here is a letterhead and nothing more. The firm is one legal entity
-- with one tax registration and one unbroken run of document numbers, and the
-- FTA reads a gap in a sequence as a missing invoice; a branch that numbered
-- separately would need its own registration and its own sequence, which is a
-- different thing from "the print template changes accordingly". If that is
-- what the practice needs, it is a decision about the entity, not a column.

CREATE TABLE branches (
  -- Generated from the English name, never typed: `dubai`, `ajman`.
  code          text        PRIMARY KEY,
  name_en       text        NOT NULL,
  name_ar       text        NOT NULL,

  -- One line each, in the order they print. Empty means "use the firm-wide
  -- addresses", so a branch that has not been filled in yet prints what the
  -- documents print today rather than a blank footer.
  addresses     jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- A branch's own bank account, where it has one. Null falls back to the
  -- firm's, field by field is not offered: an invoice that printed one
  -- branch's IBAN under another's account holder is a payment to the wrong place.
  bank_account_holder text,
  bank_iban           text,
  bank_bic            text,

  logo_url      text,
  stamp_url     text,

  -- Retired rather than deleted: invoices already issued under it still print
  -- as it, and a client may be holding one.
  retired_at    timestamptz,
  position      integer     NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT branches_code_shape CHECK (code ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT branches_named CHECK (
    length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0
  ),
  CONSTRAINT branches_addresses_are_a_list CHECK (jsonb_typeof(addresses) = 'array'),
  -- All of a bank account or none of it. An IBAN with no holder is a number
  -- somebody pays into without being able to say whose it is.
  CONSTRAINT branches_bank_complete CHECK (
    (bank_account_holder IS NULL) = (bank_iban IS NULL)
  )
);

CREATE TRIGGER branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The two the firm has. Addresses are filled in from Settings: they are not
-- known here, and the documents fall back to the firm-wide ones until they are.
INSERT INTO branches (code, name_en, name_ar, position) VALUES
  ('dubai', 'Dubai Branch', 'فرع دبي', 0),
  ('ajman', 'Ajman Branch', 'فرع عجمان', 1);

-- Which branch a document went out under. Null is the firm-wide letterhead,
-- which is what every document issued before this existed was printed on.
ALTER TABLE quotations ADD COLUMN branch_code text REFERENCES branches (code) ON DELETE RESTRICT;
ALTER TABLE invoices   ADD COLUMN branch_code text REFERENCES branches (code) ON DELETE RESTRICT;

CREATE INDEX quotations_branch_idx ON quotations (branch_code) WHERE branch_code IS NOT NULL;
CREATE INDEX invoices_branch_idx   ON invoices (branch_code)   WHERE branch_code IS NOT NULL;

COMMENT ON TABLE branches IS
  'Letterheads of the one legal entity: name, addresses and optionally their own bank, logo and stamp. Not separate registrations or number sequences.';
COMMENT ON COLUMN invoices.branch_code IS
  'The branch this was issued under, fixed at issue. Null is the firm-wide letterhead.';
