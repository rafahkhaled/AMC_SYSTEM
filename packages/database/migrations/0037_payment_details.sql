/*
 * How a payment actually arrived, and what was forgiven (FR-33).
 *
 * `reference` was one free-text box doing three jobs: a cheque number, a bank
 * name, a transfer reference. A practice chasing an unpresented cheque needs
 * its number and its date as fields, not as a sentence somebody typed.
 *
 * `discount_minor` is the gap the firm agreed to drop. Recording it as a
 * smaller payment would lose the fact that a decision was made — the invoice
 * would simply look part-paid for ever, and nobody could tell a write-off
 * from a debt.
 */
ALTER TABLE payments
  ADD COLUMN cheque_number  text,
  ADD COLUMN cheque_date    date,
  ADD COLUMN bank_name      text,
  ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN discount_reason text;

ALTER TABLE payments
  ADD CONSTRAINT payments_discount_not_negative CHECK (discount_minor >= 0),
  /* A sum written off without a reason is one nobody can answer for later. */
  ADD CONSTRAINT payments_discount_has_a_reason
    CHECK (discount_minor = 0 OR nullif(btrim(discount_reason), '') IS NOT NULL),
  /* Cheque details belong to a cheque. */
  ADD CONSTRAINT payments_cheque_details_need_a_cheque
    CHECK (method = 'cheque' OR (cheque_number IS NULL AND cheque_date IS NULL));

COMMENT ON COLUMN payments.discount_minor IS
  'Agreed reduction, recorded so a write-off is not mistaken for a debt.';
