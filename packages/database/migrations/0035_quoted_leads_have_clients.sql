/*
 * A quoted enquiry has a client record too (FR-01, FR-30).
 *
 * The rule was "a client id means confirmed", written when the only way to
 * get one was winning the work. Quoting needs one earlier: a formal quotation
 * names a company, and that name is a client — so the record exists from the
 * quote onwards and the status says whether they have said yes.
 *
 * The constraint still holds the part that matters. A client id on a new,
 * contacted or declined enquiry is still refused, because none of those has
 * been quoted and a client record would have come from nowhere.
 */
ALTER TABLE leads
  DROP CONSTRAINT leads_converted_is_confirmed;

ALTER TABLE leads
  ADD CONSTRAINT leads_client_is_quoted_or_confirmed
    CHECK (converted_client_id IS NULL OR status IN ('quoted', 'confirmed'));
