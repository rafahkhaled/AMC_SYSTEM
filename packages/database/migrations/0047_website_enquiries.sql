-- Enquiries that arrive from the firm's website.
--
-- The website's form posts to the application, which records the visitor as a
-- lead. "website" is its own source, so how many enquiries the site brings in
-- can be counted apart from phone calls and WhatsApp.
ALTER TABLE leads DROP CONSTRAINT leads_source_known;
ALTER TABLE leads
  ADD CONSTRAINT leads_source_known
  CHECK (source IN ('whatsapp', 'phone', 'referral', 'advertisement', 'walk_in', 'website', 'other'));
