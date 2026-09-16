-- The contact log (FR-06).
--
-- What was said to a client, when, and by whom. A practice that chases people
-- for documents lives or dies on this: "we asked three times" is only worth
-- saying if it can be shown, and the escalation ladder counts from the day a
-- document was first requested.
--
-- Deliberately not the same table as `client_contacts`. That one holds the
-- people at a client — their name, phone and email. This holds the
-- conversations with them, and merging the two would mean a person could not
-- be spoken to twice.

CREATE TABLE client_contact_log (
  id           text        PRIMARY KEY,
  client_id    text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  -- Which person at the client, when it is known. A call to the main number
  -- has none, and refusing to record that would lose the entry entirely.
  contact_id   text        REFERENCES client_contacts (id) ON DELETE SET NULL,
  -- Who at the practice. Kept even if they leave, because the entry is a
  -- record of what happened and not of who currently works here.
  user_id      text        REFERENCES users (id) ON DELETE SET NULL,

  channel      text        NOT NULL,
  direction    text        NOT NULL,
  -- When the conversation happened, which is not when it was typed up.
  happened_at  timestamptz NOT NULL,
  summary      text        NOT NULL,
  -- The task it was about, when it was about one. That is what lets a task
  -- show its own chasing history rather than the client's whole log.
  task_id      text        REFERENCES tasks (id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_contact_log_channel_known CHECK (channel IN (
    'call', 'whatsapp', 'email', 'meeting', 'portal', 'other'
  )),
  CONSTRAINT client_contact_log_direction_known CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT client_contact_log_summary_present CHECK (length(btrim(summary)) >= 3)
);

-- The question this table is asked: what has happened with this client, most
-- recent first.
CREATE INDEX client_contact_log_client_idx
  ON client_contact_log (client_id, happened_at DESC);

CREATE INDEX client_contact_log_task_idx ON client_contact_log (task_id)
  WHERE task_id IS NOT NULL;

CREATE TRIGGER client_contact_log_updated_at BEFORE UPDATE ON client_contact_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * The screenshots.
 *
 * A separate table rather than columns on the entry, because a WhatsApp thread
 * is several images and a call is none. The file itself lives in storage under
 * a key this system derives; only the key is here.
 */
CREATE TABLE contact_log_attachments (
  id            text        PRIMARY KEY,
  entry_id      text        NOT NULL REFERENCES client_contact_log (id) ON DELETE CASCADE,
  storage_key   text        NOT NULL,
  original_name text        NOT NULL,
  content_type  text        NOT NULL,
  checksum      text        NOT NULL,
  size_bytes    integer     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_log_attachments_size_positive CHECK (size_bytes > 0)
);

CREATE INDEX contact_log_attachments_entry_idx ON contact_log_attachments (entry_id);

COMMENT ON TABLE client_contact_log IS
  'Conversations with a client. client_contacts holds the people; this holds what was said to them.';
