-- Advertising campaigns, and which enquiries each one brought in.
--
-- Until now an enquiry's source was one of six fixed words and a free-text
-- detail, so "what did the Instagram campaign cost, and how many clients did it
-- bring" had no answer. A campaign is a named effort on a channel with a cost,
-- and an enquiry can point at it.

-- The channels (WhatsApp, Instagram, …) are a list the firm edits like the
-- other lists in Settings, so a new channel does not need a developer.
ALTER TABLE reference_options DROP CONSTRAINT reference_options_known_list;
ALTER TABLE reference_options
  ADD CONSTRAINT reference_options_known_list
  CHECK (list IN ('document_type', 'authority', 'payment_method', 'portal', 'campaign_type'));

INSERT INTO reference_options (id, list, code, name_en, name_ar, position) VALUES
  ('ro-ct-01', 'campaign_type', 'whatsapp',  'WhatsApp',  'واتساب',     10),
  ('ro-ct-02', 'campaign_type', 'instagram', 'Instagram', 'إنستغرام',   20),
  ('ro-ct-03', 'campaign_type', 'facebook',  'Facebook',  'فيسبوك',     30),
  ('ro-ct-04', 'campaign_type', 'google',    'Google',    'جوجل',       40),
  ('ro-ct-05', 'campaign_type', 'linkedin',  'LinkedIn',  'لينكدإن',    50),
  ('ro-ct-06', 'campaign_type', 'other',     'Other',     'أخرى',       999);

CREATE TABLE campaigns (
  id             text        PRIMARY KEY,
  name           text        NOT NULL,
  -- A code from the campaign_type list. Shape only here; whether it is on the
  -- list is asked of the list when the campaign is saved.
  type_code      text        NOT NULL,
  starts_on      date        NOT NULL,
  duration_days  integer,
  -- Who runs it. Kept if the person leaves, so the history still reads.
  salesperson_id text        REFERENCES users (id) ON DELETE SET NULL,
  notes          text,
  status         text        NOT NULL DEFAULT 'planned',
  cost_minor     bigint      NOT NULL DEFAULT 0,
  currency       text        NOT NULL DEFAULT 'AED',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_name_present  CHECK (length(btrim(name)) > 0),
  CONSTRAINT campaigns_type_shape    CHECK (type_code ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT campaigns_status_known  CHECK (status IN ('planned', 'active', 'ended')),
  CONSTRAINT campaigns_cost_not_negative CHECK (cost_minor >= 0),
  CONSTRAINT campaigns_duration_positive CHECK (duration_days IS NULL OR duration_days > 0)
);

CREATE INDEX campaigns_status_idx ON campaigns (status, starts_on DESC);

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which campaign brought an enquiry. Null for the ones that came some other way.
-- A campaign is never deleted, so this never dangles; SET NULL is the safety net.
ALTER TABLE leads ADD COLUMN campaign_id text REFERENCES campaigns (id) ON DELETE SET NULL;
CREATE INDEX leads_campaign_idx ON leads (campaign_id) WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE campaigns IS
  'Advertising campaigns: a named effort on a channel, with a cost. Enquiries point at one; clients are counted through the enquiries they converted from.';
