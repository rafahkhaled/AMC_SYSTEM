-- What a quotation line actually charges (feedback item 13).
--
-- The firm's own request: on each line, pick the service out of the list the
-- projects section already offers, allow a discount against the agreed amount,
-- and say whether VAT applies at five percent or the line is out of scope —
-- then show the client the total they are actually being charged.
--
-- Three columns rather than one calculated figure. A quotation is an offer the
-- client holds the firm to, so the parts have to survive: "we gave them 500
-- off" and "that line carried no VAT" are both answers somebody needs months
-- later, and a stored total can answer neither.

ALTER TABLE quotation_lines
  -- Which service this line is for, out of the eleven the firm offers.
  --
  -- A code, not a foreign key: the services are a union in the domain with a
  -- task template behind each one, not rows anybody edits. Null for a line
  -- that is genuinely not one of them — a disbursement, an authority fee —
  -- because forcing every line into a service would mean inventing one.
  ADD COLUMN service_code    text,

  -- Off this line, before VAT. Whole minor units, like every other amount.
  ADD COLUMN discount_minor  bigint  NOT NULL DEFAULT 0,

  -- VAT on this line, in basis points. 500 is the UAE's five percent.
  --
  -- NULL means out of scope, which is not the same claim as zero: a line at
  -- zero percent is a taxable supply the firm charged nothing on, and an
  -- out-of-scope line is not a taxable supply at all. They sit in different
  -- boxes on the return, so the column distinguishes them rather than
  -- collapsing both into 0.
  --
  -- Stored on the line, not looked up: the rate that applied when the client
  -- was quoted is the rate they agreed to, whatever it becomes later.
  ADD COLUMN vat_basis_points integer;

ALTER TABLE quotation_lines
  ADD CONSTRAINT quotation_lines_discount_not_negative
    CHECK (discount_minor >= 0),

  ADD CONSTRAINT quotation_lines_vat_is_a_rate
    CHECK (vat_basis_points IS NULL OR (vat_basis_points BETWEEN 0 AND 10000)),

  -- A discount cannot exceed the line it comes off.
  --
  -- Without this a line charges a negative amount, the quotation total goes
  -- down when a line is added, and the client receives a document that reads
  -- as a credit note. The hours arm repeats the rounding rule from the domain
  -- (ADR-0003, half away from zero) because the amount being discounted is the
  -- rounded one the client sees, not the exact ratio.
  ADD CONSTRAINT quotation_lines_discount_within_the_line
    CHECK (
      CASE kind
        WHEN 'fixed' THEN discount_minor <= coalesce(amount_minor, 0)
        ELSE discount_minor <= round(
          (coalesce(hours_centi, 0)::numeric * coalesce(per_hour_minor, 0)) / 100
        )
      END
    );

COMMENT ON COLUMN quotation_lines.service_code IS
  'Which of the firm''s services this line is for. Null where the line is not a service at all.';
COMMENT ON COLUMN quotation_lines.discount_minor IS
  'Taken off this line before VAT, in whole minor units. Never more than the line itself.';
COMMENT ON COLUMN quotation_lines.vat_basis_points IS
  'VAT on this line; 500 is five percent. NULL is out of scope, which is a different claim from zero.';
