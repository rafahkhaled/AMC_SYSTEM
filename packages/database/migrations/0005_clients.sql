-- Clients, their tax registrations, and the history of what they are charged.

CREATE TABLE clients (
  id                        text        PRIMARY KEY,
  legal_name                text        NOT NULL,
  legal_name_arabic         text,
  trade_licence_number      text,
  status                    text        NOT NULL DEFAULT 'active',

  -- VAT. The state is three-valued on purpose: deregistered is not the same as
  -- never registered, because filings made while registered still exist and
  -- still carry the number.
  vat_state                 text        NOT NULL DEFAULT 'not_registered',
  vat_trn                   text,
  vat_registered_on         date,
  vat_deregistered_on       date,
  vat_frequency             text,
  -- Any month in which one of this client's VAT periods ends. UAE quarters are
  -- staggered per business, so this cannot be assumed to be March.
  vat_anchor_end_month      smallint,

  ct_state                  text        NOT NULL DEFAULT 'not_registered',
  ct_trn                    text,
  ct_registered_on          date,
  ct_deregistered_on        date,
  -- The month the financial year ends. The corporation tax return is due nine
  -- months later, so this is what decides the deadline.
  financial_year_end_month  smallint,

  onboarded_on              timestamptz NOT NULL DEFAULT now(),
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clients_legal_name_present CHECK (length(btrim(legal_name)) > 0),
  CONSTRAINT clients_status_known       CHECK (status IN ('active', 'dormant', 'closed')),
  CONSTRAINT clients_vat_state_known    CHECK (vat_state IN ('not_registered', 'registered', 'deregistered')),
  CONSTRAINT clients_ct_state_known     CHECK (ct_state IN ('not_registered', 'registered', 'deregistered')),
  CONSTRAINT clients_vat_frequency_known CHECK (vat_frequency IS NULL OR vat_frequency IN ('monthly', 'quarterly')),
  CONSTRAINT clients_vat_month_range    CHECK (vat_anchor_end_month IS NULL OR vat_anchor_end_month BETWEEN 1 AND 12),
  CONSTRAINT clients_fy_month_range     CHECK (financial_year_end_month IS NULL OR financial_year_end_month BETWEEN 1 AND 12),

  -- A tax registration number is fifteen digits. Checked here as well as in
  -- the domain, because the database is the only place that can promise it for
  -- every row however it arrived.
  CONSTRAINT clients_vat_trn_shape      CHECK (vat_trn IS NULL OR vat_trn ~ '^[0-9]{15}$'),
  CONSTRAINT clients_ct_trn_shape       CHECK (ct_trn IS NULL OR ct_trn ~ '^[0-9]{15}$'),

  -- A client registered for VAT must have a number and a cycle. Without the
  -- cycle there is no filing date, and a registered client with no deadline is
  -- exactly the one who gets missed.
  CONSTRAINT clients_vat_registration_complete CHECK (
    vat_state <> 'registered'
    OR (vat_trn IS NOT NULL AND vat_frequency IS NOT NULL AND vat_anchor_end_month IS NOT NULL)
  ),
  CONSTRAINT clients_ct_registration_complete CHECK (
    ct_state <> 'registered'
    OR (ct_trn IS NOT NULL AND financial_year_end_month IS NOT NULL)
  ),
  CONSTRAINT clients_deregistered_has_date CHECK (
    (vat_state = 'deregistered') = (vat_deregistered_on IS NOT NULL)
  )
);

-- One number, one client. Partial, so the many clients without a registration
-- do not collide with each other on null.
CREATE UNIQUE INDEX clients_vat_trn_idx ON clients (vat_trn) WHERE vat_trn IS NOT NULL;
CREATE UNIQUE INDEX clients_ct_trn_idx  ON clients (ct_trn)  WHERE ct_trn IS NOT NULL;

CREATE INDEX clients_status_idx ON clients (status);
-- The deadline engine's question every month: who files a VAT period ending now?
CREATE INDEX clients_vat_cycle_idx ON clients (vat_anchor_end_month)
  WHERE vat_state = 'registered';

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * What a client is charged, and what they used to be charged (FR-03).
 *
 * Effective-dated rather than a single column, because an invoice raised in
 * March must keep March's rate for ever. A statement reprinted after an April
 * rise would otherwise disagree with the one the client already paid.
 */
CREATE TABLE client_rates (
  id              text        PRIMARY KEY,
  client_id       text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  per_hour_minor  bigint      NOT NULL,
  currency        text        NOT NULL DEFAULT 'AED',
  effective_from  date        NOT NULL,
  changed_by      text        NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_rates_not_negative CHECK (per_hour_minor >= 0),
  -- Two rates on one day would make "the rate that day" ambiguous, and which
  -- one won would depend on the order rows came back in.
  CONSTRAINT client_rates_one_per_day UNIQUE (client_id, effective_from)
);

CREATE INDEX client_rates_lookup_idx ON client_rates (client_id, effective_from DESC);

COMMENT ON COLUMN client_rates.per_hour_minor IS
  'Whole fils. No floating point anywhere in the billing path (ADR-0003).';
