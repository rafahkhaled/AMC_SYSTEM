-- UAE PASS has no password: it is opened with an email, a mobile number or an
-- Emirates ID number, and that is what the firm needs to have written down.
-- Not a secret, so on the client and not in the vault.
ALTER TABLE clients ADD COLUMN tax_login_id text;
