/*
 * The four VAT returns of the year: when each is due and when the firm filed
 * it, typed from the authority's portal like the corporation tax return's.
 * Kept as one list of up to four, in the order of the year's quarters.
 */
ALTER TABLE clients
  ADD COLUMN vat_returns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT clients_vat_returns_four CHECK (
    jsonb_typeof(vat_returns) = 'array' AND jsonb_array_length(vat_returns) <= 4
  );
