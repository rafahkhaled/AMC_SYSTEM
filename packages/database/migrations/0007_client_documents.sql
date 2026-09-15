-- The document repository per client (FR-04), and the expiry dates that drive
-- the staged reminders (FR-42).

CREATE TABLE client_documents (
  id                text        PRIMARY KEY,
  client_id         text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  type              text        NOT NULL,
  label             text,

  -- Workflow only. Expiry is deliberately absent from this list: it is a fact
  -- about a date, and storing it as a state would need something to run
  -- nightly to keep it true, leaving a window where this column and the
  -- calendar disagree.
  status            text        NOT NULL DEFAULT 'required',

  storage_key       text,
  original_name     text,
  checksum          text,
  issued_on         date,
  expires_on        date,

  -- Renewal keeps the old version rather than overwriting it, because a task
  -- completed in March used the licence valid in March.
  superseded_by_id  text        REFERENCES client_documents (id) ON DELETE SET NULL,

  uploaded_by       text,
  uploaded_at       timestamptz,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_documents_status_known CHECK (status IN ('required', 'held', 'renewing')),
  CONSTRAINT client_documents_type_known CHECK (type IN (
    'trade_licence', 'emirates_id', 'passport', 'visa', 'memorandum',
    'tenancy_contract', 'vat_certificate', 'corporate_tax_certificate',
    'bank_letter', 'other'
  )),
  -- A document we hold has a file behind it. One without is a checklist entry.
  CONSTRAINT client_documents_held_has_file CHECK (
    status = 'required' OR (storage_key IS NOT NULL AND checksum IS NOT NULL)
  ),
  CONSTRAINT client_documents_expiry_after_issue CHECK (
    issued_on IS NULL OR expires_on IS NULL OR expires_on > issued_on
  ),
  -- A document cannot replace itself.
  CONSTRAINT client_documents_not_self_superseding CHECK (superseded_by_id IS DISTINCT FROM id)
);

CREATE INDEX client_documents_client_idx ON client_documents (client_id, type);

/*
 * The question the deadline engine asks every morning: what expires soon?
 *
 * Partial, so it covers only the rows that can answer it. Superseded versions
 * and documents under renewal are excluded, because chasing a licence that has
 * already been replaced is how a client learns to ignore the reminders.
 */
CREATE INDEX client_documents_expiring_idx
  ON client_documents (expires_on)
  WHERE expires_on IS NOT NULL AND superseded_by_id IS NULL AND status = 'held';

-- One live document of each type per client. Older versions are excluded, so a
-- renewal chain does not trip over itself.
CREATE UNIQUE INDEX client_documents_current_idx
  ON client_documents (client_id, type, COALESCE(label, ''))
  WHERE superseded_by_id IS NULL;

CREATE TRIGGER client_documents_updated_at BEFORE UPDATE ON client_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN client_documents.checksum IS
  'SHA-256 of the file. Proves the document behind a completed task is still the one that was used.';
