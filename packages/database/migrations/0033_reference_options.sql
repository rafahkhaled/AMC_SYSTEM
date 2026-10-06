/*
 * The dropdowns an administrator can extend (FR-03).
 *
 * Document types, the authority that issued a document, how a payment
 * arrived: lists that were fixed in code, so adding "Establishment Card" or a
 * new free-zone authority meant a developer and a deploy. A practice learns a
 * new document type when a client walks in with one.
 *
 * Not every dropdown belongs here, and the ones that do not are the point of
 * the `list` column being a closed set. Project states drive a state machine,
 * roles decide permissions, and services carry a task template and a deadline
 * rule — adding a row to any of those produces a name with no behaviour
 * behind it, which is worse than refusing.
 */
CREATE TABLE reference_options (
  id          text PRIMARY KEY,
  list        text NOT NULL,
  /* The stored value. Rows elsewhere hold this, which is why it never changes
     once written — renaming is what name_en and name_ar are for. */
  code        text NOT NULL,
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  /*
   * Retired, not deleted.
   *
   * A document already filed as `trade_licence` has to keep displaying as a
   * trade licence after somebody decides the firm no longer asks for them.
   * Deactivating takes it out of the dropdown and leaves history legible —
   * the same bargain suspending an employee makes.
   */
  retired_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text REFERENCES users(id),

  CONSTRAINT reference_options_known_list
    CHECK (list IN ('document_type', 'authority', 'payment_method')),
  CONSTRAINT reference_options_code_shape
    CHECK (code ~ '^[a-z0-9_]{1,40}$')
);

CREATE UNIQUE INDEX reference_options_unique ON reference_options (list, code);
CREATE INDEX reference_options_listing ON reference_options (list, position, code);

COMMENT ON COLUMN reference_options.retired_at IS
  'Set to take the option out of new dropdowns while keeping old rows readable.';

/* The lists as they were in code, so nothing changes on the day this ships. */
INSERT INTO reference_options (id, list, code, name_en, name_ar, position) VALUES
  ('ro-dt-01', 'document_type', 'trade_licence',             'Trade licence',            'الرخصة التجارية',       10),
  ('ro-dt-02', 'document_type', 'emirates_id',               'Emirates ID',              'الهوية الإماراتية',      20),
  ('ro-dt-03', 'document_type', 'passport',                  'Passport',                 'جواز السفر',            30),
  ('ro-dt-04', 'document_type', 'visa',                      'Visa',                     'الإقامة',               40),
  ('ro-dt-05', 'document_type', 'memorandum',                'Memorandum',               'عقد التأسيس',           50),
  ('ro-dt-06', 'document_type', 'tenancy_contract',          'Tenancy contract',         'عقد الإيجار',           60),
  ('ro-dt-07', 'document_type', 'vat_certificate',           'VAT certificate',          'شهادة القيمة المضافة',  70),
  ('ro-dt-08', 'document_type', 'corporate_tax_certificate', 'Corporate tax certificate','شهادة ضريبة الشركات',   80),
  ('ro-dt-09', 'document_type', 'bank_letter',               'Bank letter',              'خطاب البنك',            90),
  ('ro-dt-10', 'document_type', 'other',                     'Other',                    'أخرى',                 999),

  ('ro-au-01', 'authority', 'ded',        'DED — Department of Economic Development', 'دائرة التنمية الاقتصادية', 10),
  ('ro-au-02', 'authority', 'fta',        'FTA — Federal Tax Authority',              'الهيئة الاتحادية للضرائب', 20),
  ('ro-au-03', 'authority', 'moh',        'Ministry of Human Resources',              'وزارة الموارد البشرية',    30),
  ('ro-au-04', 'authority', 'gdrfa',      'GDRFA — Residency and Foreigners Affairs', 'الإقامة وشؤون الأجانب',    40),
  ('ro-au-05', 'authority', 'free_zone',  'Free zone authority',                      'سلطة المنطقة الحرة',       50),
  ('ro-au-06', 'authority', 'bank',       'Bank',                                     'البنك',                    60),
  ('ro-au-07', 'authority', 'other',      'Other',                                    'أخرى',                    999),

  ('ro-pm-01', 'payment_method', 'bank_transfer', 'Bank transfer', 'تحويل بنكي', 10),
  ('ro-pm-02', 'payment_method', 'cheque',        'Cheque',        'شيك',        20),
  ('ro-pm-03', 'payment_method', 'cash',          'Cash',          'نقداً',       30),
  ('ro-pm-04', 'payment_method', 'card',          'Card',          'بطاقة',      40),
  ('ro-pm-05', 'payment_method', 'other',         'Other',         'أخرى',       999);
