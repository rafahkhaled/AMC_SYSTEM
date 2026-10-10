-- Services the firm adds itself (feedback item 8).
--
-- The eleven built-in services stay in code: each one carries a deadline rule
-- and a recurrence the engine has to understand, and a row cannot say "nine
-- months after the client's financial year ends". What a row *can* say is the
-- simple case the firm actually asked for — "we have started doing X; it is
-- done once per client, has these steps, needs these documents" — so that is
-- all a custom service is.
--
-- Deliberately one-off. A recurring custom service would need its own period
-- rule and its own sweep, which is the part that has to be code. Saying so
-- here is better than a column that looks like it works.

CREATE TABLE custom_services (
  -- `custom_` + a slug of the English name. Generated, never typed: an admin
  -- picking codes is how two services end up answering to one.
  code           text        PRIMARY KEY,
  name_en        text        NOT NULL,
  name_ar        text        NOT NULL,

  -- Calendar days from the day the work starts to when it is due. NULL means
  -- the date is set by hand, which is what the built-in manual rule means too.
  deadline_days  integer,

  -- [{ "nameEn": "...", "nameAr": "..." }, ...] in the order the work happens.
  -- A step has no life outside its service and is never queried on its own, so
  -- it is part of the row rather than a table of its own.
  steps          jsonb       NOT NULL,
  -- [{ "type": "trade_licence", "mandatory": true }, ...]. The types are
  -- document_type reference options; checked where the row is written, since a
  -- foreign key cannot point into one list of a shared table.
  required_documents jsonb   NOT NULL DEFAULT '[]'::jsonb,

  -- Retired rather than deleted: projects already opened under it still have
  -- to render their steps, and a client may still be subscribed.
  retired_at     timestamptz,
  position       integer     NOT NULL DEFAULT 0,

  created_by     text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT custom_services_code_shape CHECK (code ~ '^custom_[a-z0-9_]{1,60}$'),
  CONSTRAINT custom_services_named CHECK (
    length(btrim(name_en)) > 0 AND length(btrim(name_ar)) > 0
  ),
  CONSTRAINT custom_services_deadline_sane CHECK (
    deadline_days IS NULL OR deadline_days BETWEEN 1 AND 730
  ),
  CONSTRAINT custom_services_has_steps CHECK (
    jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0
  ),
  CONSTRAINT custom_services_documents_are_a_list CHECK (
    jsonb_typeof(required_documents) = 'array'
  )
);

CREATE TRIGGER custom_services_updated_at BEFORE UPDATE ON custom_services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A client can now be engaged for a custom service as well as the eleven.
ALTER TABLE client_services DROP CONSTRAINT client_services_known;
ALTER TABLE client_services ADD CONSTRAINT client_services_known CHECK (
  service IN (
    'ct_registration', 'vat_registration', 'vat_return', 'ct_return',
    'tax_profile_update', 'deregistration', 'vat_refund', 'penalty_waiver',
    'emaratax_request', 'monthly_accounting', 'audit'
  )
  OR service ~ '^custom_[a-z0-9_]{1,60}$'
);

COMMENT ON TABLE custom_services IS
  'Services added by the firm: one-off, with their own steps and required documents. The eleven built-ins live in code.';
