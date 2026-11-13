-- A second mobile for the person to call, who often has two, and where the
-- corporation tax return stands in the firm's own words (Done, In progress…).
-- Each VAT return's status lives inside vat_returns, beside its dates.
ALTER TABLE clients ADD COLUMN mobile_2 text;
ALTER TABLE clients ADD COLUMN ct_return_status text;

-- Social media as its own way of speaking to a client: "the portal" was being
-- read as that, when it means the tax authority's portal.
ALTER TABLE client_contact_log DROP CONSTRAINT IF EXISTS client_contact_log_channel_known;
DO $$
DECLARE name text;
BEGIN
  FOR name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'client_contact_log'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE client_contact_log DROP CONSTRAINT %I', name);
  END LOOP;
END $$;
ALTER TABLE client_contact_log ADD CONSTRAINT client_contact_log_channel_known CHECK (
  channel IN ('call', 'whatsapp', 'email', 'meeting', 'portal', 'social_media', 'other')
);

-- What stands in a tax number box is the firm's own words; 60 characters was
-- too few for them. Still bounded, so the box holds a note and not a letter.
ALTER TABLE clients
  DROP CONSTRAINT clients_vat_remark_short,
  DROP CONSTRAINT clients_ct_remark_short,
  ADD CONSTRAINT clients_vat_remark_short CHECK (vat_remark IS NULL OR length(vat_remark) BETWEEN 1 AND 500),
  ADD CONSTRAINT clients_ct_remark_short  CHECK (ct_remark  IS NULL OR length(ct_remark)  BETWEEN 1 AND 500);
