-- Enquiries, the people at a client, and which accountant may see whom.

CREATE TABLE leads (
  id                  text        PRIMARY KEY,
  name                text        NOT NULL,
  phone               text,
  email               citext,
  source              text        NOT NULL,
  -- Which advertisement, which referrer. The category is what gets counted;
  -- this is what tells you what actually worked.
  source_detail       text,
  requested_service   text,
  status              text        NOT NULL DEFAULT 'new',
  -- The lead is kept after conversion rather than replaced, so "where did this
  -- client come from?" still has an answer a year later.
  converted_client_id text        REFERENCES clients (id) ON DELETE SET NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leads_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT leads_status_known CHECK (status IN ('new', 'contacted', 'quoted', 'confirmed', 'declined')),
  CONSTRAINT leads_source_known CHECK (source IN ('whatsapp', 'phone', 'referral', 'advertisement', 'walk_in', 'other')),
  -- Someone has to be reachable, or it cannot be followed up and is not a lead.
  CONSTRAINT leads_reachable CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT leads_converted_is_confirmed CHECK (converted_client_id IS NULL OR status = 'confirmed')
);

CREATE INDEX leads_status_idx   ON leads (status, received_at DESC);
CREATE INDEX leads_source_idx   ON leads (source);
CREATE UNIQUE INDEX leads_client_idx ON leads (converted_client_id) WHERE converted_client_id IS NOT NULL;

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * The people at a client.
 *
 * The client is a company: the tax number, the rate and the invoices belong to
 * it. A login belongs to a person, so the portal user in a later phase is a
 * contact pointing at a users row rather than the client itself.
 */
CREATE TABLE client_contacts (
  id          text        PRIMARY KEY,
  client_id   text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id     text        REFERENCES users (id) ON DELETE SET NULL,
  name        text        NOT NULL,
  role        text,
  phone       text,
  email       citext,
  is_primary  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_contacts_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT client_contacts_reachable CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- One primary contact per client. Without this, "who do we chase?" has two
-- answers and the follow-up module picks whichever row came back first.
CREATE UNIQUE INDEX client_contacts_primary_idx
  ON client_contacts (client_id) WHERE is_primary;

CREATE INDEX client_contacts_client_idx ON client_contacts (client_id);
CREATE INDEX client_contacts_user_idx   ON client_contacts (user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER client_contacts_updated_at BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Which staff member may see which client (SRS 2.2).
 *
 * An accountant reaches their assigned clients and no others. This table is
 * what the repositories join against; it is not a hint to the interface.
 */
CREATE TABLE client_staff_access (
  client_id   text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text        NOT NULL,

  PRIMARY KEY (client_id, user_id)
);

-- The question asked on every scoped read: which clients may this person see?
CREATE INDEX client_staff_access_user_idx ON client_staff_access (user_id);

COMMENT ON TABLE client_staff_access IS
  'Row-level scoping for accountants. Enforced in repositories, not merely hidden in the interface.';
