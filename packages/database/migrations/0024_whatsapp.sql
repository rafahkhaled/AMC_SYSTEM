-- WhatsApp conversations and the messages in them (PW-02).
--
-- The practice already chases clients on WhatsApp; it does it by hand, out of
-- somebody's phone, and the record of it is a screenshot pasted into the
-- contact log afterwards. These two tables are that conversation moved inside
-- the system, so that "we asked three times" is a query rather than a memory.

/*
 * One conversation per phone number, for the life of that number.
 *
 * Not one per client: a client has several people and each writes from their
 * own phone, and not one per thread either, because WhatsApp has no threads —
 * there is one continuous conversation with a number and it never ends. The
 * unique constraint on the number is what makes an inbound message findable
 * without a search.
 */
CREATE TABLE whatsapp_conversations (
  id               text        PRIMARY KEY,
  -- Already reduced, by @amc/kernel's toE164, before it reaches this table.
  -- Not generated from anything, because there is no raw form here to generate
  -- it from: WhatsApp only ever gives the reduced one.
  phone_e164       text        NOT NULL UNIQUE,

  -- Who this is, when it is known. Both are nullable and stay nullable: a
  -- stranger writing in for the first time is a conversation with no client,
  -- and refusing to record it would mean the first message from every new
  -- client is the one that gets lost.
  client_id        text        REFERENCES clients (id) ON DELETE SET NULL,
  contact_id       text        REFERENCES client_contacts (id) ON DELETE SET NULL,
  -- The name on their WhatsApp profile. Worth keeping for an unmatched number,
  -- because it is the only thing anyone has to go on.
  profile_name     text,

  -- Which language to answer in. Decided from what they write and remembered,
  -- so somebody who writes in Arabic once is not answered in English later.
  language         text        NOT NULL DEFAULT 'ar',

  -- Who is answering: the bot, a named person who took over, or nobody
  -- because the conversation was closed.
  handling         text        NOT NULL DEFAULT 'bot',
  assigned_user_id text        REFERENCES users (id) ON DELETE SET NULL,

  -- What the bot last asked for, so the next message can be read as an answer
  -- to it rather than out of nowhere. Null when it is not waiting on anything.
  awaiting         text,

  -- How many messages in a row the bot has failed to understand. A bot that
  -- says "sorry, I didn't catch that" three times is worse than no bot, so
  -- this is what makes it give up and fetch somebody.
  unclear_streak   smallint    NOT NULL DEFAULT 0,

  /*
   * When they asked not to be messaged automatically, and null while they have
   * not.
   *
   * Separate from `handling = 'closed'`, which only means nothing is
   * outstanding. Closing a conversation still allows an approved template
   * through — that is how a chase starts — so treating STOP as closing would
   * have the client receive the next automatic reminder anyway, which is the
   * one thing they asked not to happen.
   *
   * It does not stop a person writing to them. Their accountant still has a
   * job to do, and somebody who typed STOP at a reminder rarely meant "never
   * contact me about my tax again".
   */
  opted_out_at     timestamptz,

  -- The twenty-four hour service window runs from here. Outside it, Meta
  -- refuses anything but an approved template, so this column decides what
  -- may be sent and not merely what was received.
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_conversations_language_known CHECK (language IN ('en', 'ar')),
  CONSTRAINT whatsapp_conversations_handling_known CHECK (handling IN ('bot', 'human', 'closed')),

  -- A conversation being handled by a person has to name the person. "Somebody
  -- is dealing with it" is how a client waits four days.
  CONSTRAINT whatsapp_conversations_human_is_somebody CHECK (
    handling <> 'human' OR assigned_user_id IS NOT NULL
  ),

  -- A contact belongs to a client, so naming one without the other would let
  -- the two disagree about whose conversation this is.
  CONSTRAINT whatsapp_conversations_contact_has_client CHECK (
    contact_id IS NULL OR client_id IS NOT NULL
  ),

  CONSTRAINT whatsapp_conversations_streak_sane CHECK (unclear_streak >= 0),
  CONSTRAINT whatsapp_conversations_awaiting_known CHECK (
    awaiting IS NULL OR awaiting IN ('menu_choice', 'documents')
  )
);

CREATE INDEX whatsapp_conversations_client_idx ON whatsapp_conversations (client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX whatsapp_conversations_contact_idx ON whatsapp_conversations (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX whatsapp_conversations_assigned_idx ON whatsapp_conversations (assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

-- The screen this table exists for: what is waiting on a person, most recently
-- spoken to first.
CREATE INDEX whatsapp_conversations_queue_idx
  ON whatsapp_conversations (handling, last_inbound_at DESC NULLS LAST);

CREATE TRIGGER whatsapp_conversations_updated_at BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Every message, in both directions.
 *
 * Outbound rows are written before they are sent and carry their own delivery
 * state afterwards, so a message Meta never accepted is visible as a failure
 * rather than absent. That matters here more than it would elsewhere: the
 * whole point of the channel is being able to show that the client was asked.
 */
CREATE TABLE whatsapp_messages (
  id                   text        PRIMARY KEY,
  conversation_id      text        NOT NULL
                                   REFERENCES whatsapp_conversations (id) ON DELETE CASCADE,
  direction            text        NOT NULL,

  -- Meta's own id. Null for an outbound message until Meta accepts it and
  -- names it. Unique, which is the whole of the webhook's duplicate handling:
  -- Meta retries a delivery it thinks failed, and it retries often.
  provider_message_id  text,

  kind                 text        NOT NULL,
  body                 text,
  -- The approved template used, when one was. Required outside the window.
  template_name        text,

  -- Meta's handle for an attachment, before it has been fetched. The file
  -- itself becomes a client document; this is the receipt for the fetch.
  media_id             text,
  media_mime_type      text,
  media_filename       text,
  document_id          text        REFERENCES client_documents (id) ON DELETE SET NULL,

  status               text        NOT NULL,
  failure_reason       text,

  -- Who sent it. Null on an outbound message means the bot sent it, which is
  -- exactly the question asked when somebody wants to know what the client was
  -- told without anyone looking.
  sent_by_user_id      text        REFERENCES users (id) ON DELETE SET NULL,

  -- The contact log entry this message produced. The log stays the single
  -- place to ask what was said to a client; this is the link back to the
  -- message that says it.
  contact_log_entry_id text        REFERENCES client_contact_log (id) ON DELETE SET NULL,

  -- What Meta sent us verbatim, for the morning when a message was handled
  -- wrongly and the only useful question is what actually arrived.
  raw                  jsonb,

  occurred_at          timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_messages_direction_known CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT whatsapp_messages_kind_known CHECK (kind IN (
    'text', 'image', 'document', 'audio', 'video', 'sticker',
    'location', 'contacts', 'template', 'interactive', 'unsupported'
  )),
  CONSTRAINT whatsapp_messages_status_known CHECK (status IN (
    'received', 'queued', 'sent', 'delivered', 'read', 'failed'
  )),

  -- 'received' is the only state an inbound message can be in, and no outbound
  -- message can be in it. Without this, a bug that writes the wrong direction
  -- shows up as a message that was apparently never sent.
  CONSTRAINT whatsapp_messages_state_matches_direction CHECK (
    (direction = 'inbound' AND status = 'received')
    OR (direction = 'outbound' AND status <> 'received')
  ),

  -- A template message names its template. A failure names its reason.
  CONSTRAINT whatsapp_messages_template_named CHECK (
    kind <> 'template' OR template_name IS NOT NULL
  ),
  CONSTRAINT whatsapp_messages_failure_explained CHECK (
    status <> 'failed' OR failure_reason IS NOT NULL
  ),

  -- Something has to have been said. A row with neither words nor an
  -- attachment records that a message existed and nothing about it.
  CONSTRAINT whatsapp_messages_carries_something CHECK (
    body IS NOT NULL OR media_id IS NOT NULL OR template_name IS NOT NULL
  )
);

CREATE UNIQUE INDEX whatsapp_messages_provider_idx
  ON whatsapp_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- The thread, newest last when read forwards.
CREATE INDEX whatsapp_messages_conversation_idx
  ON whatsapp_messages (conversation_id, occurred_at);

CREATE INDEX whatsapp_messages_document_idx ON whatsapp_messages (document_id)
  WHERE document_id IS NOT NULL;
CREATE INDEX whatsapp_messages_sender_idx ON whatsapp_messages (sent_by_user_id)
  WHERE sent_by_user_id IS NOT NULL;
CREATE INDEX whatsapp_messages_entry_idx ON whatsapp_messages (contact_log_entry_id)
  WHERE contact_log_entry_id IS NOT NULL;

-- Outbound messages waiting to go out, which is what the sender polls.
CREATE INDEX whatsapp_messages_queued_idx ON whatsapp_messages (created_at)
  WHERE status = 'queued';

CREATE TRIGGER whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE whatsapp_conversations IS
  'One conversation per phone number. Nullable client: a stranger writing in is still a conversation.';
COMMENT ON TABLE whatsapp_messages IS
  'Every WhatsApp message in and out, with its delivery state and the contact log entry it produced.';
