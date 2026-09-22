-- Fixed fees and retainers (P2-12, FR-36).
--
-- The practice's own invoice, supplied as a template, reads:
--
--   Description              Qty    Rate        Amount
--   Tax-(VAT & CT)             1    1,750.00    1,750.00
--   CT Re-turn 2025
--
-- One line, one quantity, an agreed fee. No hours anywhere on the document.
-- That is how this firm bills most of its work, and hourly is the exception
-- rather than the rule the system had assumed.
--
-- Hours are still recorded against every project either way. They stop
-- deciding what the client pays and start answering a different question:
-- whether the fee was worth the work, which is what P2-11 reports on. A firm
-- that bills fixed fees and stops recording time cannot tell a good client
-- from a bad one until it is losing money on both.

ALTER TABLE client_services
  -- How work under this subscription is charged.
  --   hourly   — recorded time at the client's rate, as before
  --   fixed    — an agreed fee for each project
  --   retainer — an agreed fee per month, whatever projects fall in it
  ADD COLUMN pricing   text   NOT NULL DEFAULT 'hourly',
  ADD COLUMN fee_minor bigint,
  ADD COLUMN currency  text   NOT NULL DEFAULT 'AED';

ALTER TABLE client_services
  ADD CONSTRAINT client_services_pricing_known
    CHECK (pricing IN ('hourly', 'fixed', 'retainer')),
  -- A fee where one is charged, and none where it is not. Without this a
  -- subscription can claim to be fixed-fee and carry no fee, which bills the
  -- client nothing and looks like the work was free.
  ADD CONSTRAINT client_services_fee_matches_pricing
    CHECK ((pricing = 'hourly') = (fee_minor IS NULL)),
  ADD CONSTRAINT client_services_fee_not_negative
    CHECK (fee_minor IS NULL OR fee_minor >= 0);

COMMENT ON COLUMN client_services.pricing IS
  'hourly, fixed per project, or a monthly retainer. Hours are recorded either way; under a fee they answer profitability rather than the bill.';

/*
 * The same distinction on a statement line.
 *
 * `per_hour_minor` was NOT NULL because every line was hours at a rate. A
 * fixed-fee line has no rate — inventing one by dividing the fee by the hours
 * would produce a number that changes every time somebody records more time,
 * and put it on a document the client reads.
 */
ALTER TABLE statement_lines
  ADD COLUMN pricing   text   NOT NULL DEFAULT 'hourly',
  ADD COLUMN fee_minor bigint;

ALTER TABLE statement_lines
  ALTER COLUMN per_hour_minor DROP NOT NULL;

ALTER TABLE statement_lines
  ADD CONSTRAINT statement_lines_pricing_known
    CHECK (pricing IN ('hourly', 'fixed')),
  ADD CONSTRAINT statement_lines_priced_one_way
    CHECK (
      (pricing = 'hourly' AND per_hour_minor IS NOT NULL AND fee_minor IS NULL)
      OR (pricing = 'fixed' AND fee_minor IS NOT NULL AND per_hour_minor IS NULL)
    ),
  ADD CONSTRAINT statement_lines_fee_not_negative
    CHECK (fee_minor IS NULL OR fee_minor >= 0);

/*
 * An invoice line already carries only an amount, which is what the client
 * sees. These two are for the document: the template prints a quantity and a
 * rate, and for a fixed fee both come from the fee itself — quantity one, rate
 * the fee. Stored rather than derived, because the document has to keep
 * saying what it said.
 */
ALTER TABLE invoice_lines
  ADD COLUMN quantity_centi integer NOT NULL DEFAULT 100,
  ADD COLUMN unit_minor     bigint;

ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_quantity_positive CHECK (quantity_centi > 0),
  ADD CONSTRAINT invoice_lines_unit_not_negative CHECK (unit_minor IS NULL OR unit_minor >= 0);

COMMENT ON COLUMN invoice_lines.quantity_centi IS
  'Hundredths of a unit: 100 is one. Hours for an hourly line, 1 for a fixed fee, as the template prints it.';
