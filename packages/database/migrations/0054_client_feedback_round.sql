-- The firm's WhatsApp feedback on the client file.

-- A letter made by mistake can be taken off the client's list. The row stays,
-- with who removed it and when, because a letter is a thing that may have gone out.
ALTER TABLE generated_documents
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN removed_by text REFERENCES users (id) ON DELETE SET NULL;

-- What the tax number box says when there is no number: not registered (NA),
-- or the registration was refused. Kept apart from the number itself, which
-- stays fifteen digits or nothing.
ALTER TABLE clients
  ADD COLUMN vat_remark text,
  ADD COLUMN ct_remark  text,
  -- How the firm signs in to the client's tax file: an email and password, or
  -- UAE PASS (with an Emirates ID, email or mobile).
  ADD COLUMN tax_login_method text,
  ADD CONSTRAINT clients_vat_remark_known CHECK (vat_remark IS NULL OR vat_remark IN ('na', 'rejected')),
  ADD CONSTRAINT clients_ct_remark_known  CHECK (ct_remark  IS NULL OR ct_remark  IN ('na', 'rejected')),
  ADD CONSTRAINT clients_tax_login_known  CHECK (tax_login_method IS NULL OR tax_login_method IN ('email', 'uae_pass'));

-- Two more places the firm keeps logins for.
INSERT INTO reference_options (id, list, code, name_en, name_ar, position) VALUES
  ('ro-po-05', 'portal', 'accounting_software', 'Accounting software (QuickBooks)', 'البرنامج المحاسبي (QuickBooks)', 40),
  ('ro-po-06', 'portal', 'etisalat',            'Etisalat',                         'اتصالات',                         50),
  ('ro-po-07', 'portal', 'email',               'Email account',                    'البريد الإلكتروني',               5)
ON CONFLICT DO NOTHING;

-- A conversation can be logged with only when and how it happened; what was
-- said is added if there is something worth writing down.
ALTER TABLE client_contact_log DROP CONSTRAINT client_contact_log_summary_present;
