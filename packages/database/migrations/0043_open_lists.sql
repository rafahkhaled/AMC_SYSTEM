-- Letting the lists an administrator edits actually be edited.
--
-- Migration 0033 made document types, authorities and payment methods
-- editable from Settings — and left each of them enforced as a closed list
-- further down, in a CHECK on the table that stores the value. An option added
-- in Settings appeared in the dropdown and was then refused at the database,
-- which is the worst place to find out: "Establishment card" could be chosen
-- and never uploaded. Authorities happened to have no such check, which is why
-- only two of the three were broken.
--
-- What the constraints keep is the *shape* of a code, which is what protects
-- the column from a stray value. Whether the code is on the list, and still
-- offered, is the application's question, asked of the list itself.

ALTER TABLE client_documents DROP CONSTRAINT client_documents_type_known;
ALTER TABLE client_documents
  ADD CONSTRAINT client_documents_type_shape CHECK (type ~ '^[a-z0-9_]{1,40}$');

ALTER TABLE payments DROP CONSTRAINT payments_method_known;
ALTER TABLE payments
  ADD CONSTRAINT payments_method_shape CHECK (method ~ '^[a-z0-9_]{1,40}$');

-- The portals the firm keeps logins for (feedback item 7). The same fix, and a
-- fourth list: the credential kinds were a closed set of four.
ALTER TABLE client_credentials DROP CONSTRAINT client_credentials_kind_known;
ALTER TABLE client_credentials
  ADD CONSTRAINT client_credentials_kind_shape CHECK (kind ~ '^[a-z0-9_]{1,40}$');

ALTER TABLE reference_options DROP CONSTRAINT reference_options_known_list;
ALTER TABLE reference_options
  ADD CONSTRAINT reference_options_known_list
  CHECK (list IN ('document_type', 'authority', 'payment_method', 'portal'));

-- The four it had, with the codes the existing credentials already carry.
INSERT INTO reference_options (id, list, code, name_en, name_ar, position) VALUES
  ('ro-po-01', 'portal', 'emaratax',    'EmaraTax',              'إماراتاكس',                10),
  ('ro-po-02', 'portal', 'ftaportal',   'FTA portal',            'بوابة الهيئة الاتحادية للضرائب', 20),
  ('ro-po-03', 'portal', 'bank_portal', 'Bank portal',           'بوابة البنك',               30),
  ('ro-po-04', 'portal', 'other',       'Other',                 'أخرى',                     999);
