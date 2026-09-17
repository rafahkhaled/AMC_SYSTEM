-- Notifications (FR-43).
--
-- The escalation ladder already decides who should be told and when, and
-- records that it decided. What was missing was the telling. This is that:
-- an inbox somebody reads, and an email for what cannot wait until they open
-- the application.
--
-- Both halves are one row. A notification is the thing that happened; how it
-- reached somebody is a column on it, not a separate record, so "did they get
-- this?" is one question with one answer.

CREATE TABLE notifications (
  id            text        PRIMARY KEY,
  user_id       text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- What kind of thing this is, which is also what a person turns off.
  kind          text        NOT NULL,
  -- What it is about, so the inbox can link to it.
  subject_type  text        NOT NULL,
  subject_id    text        NOT NULL,
  client_id     text        REFERENCES clients (id) ON DELETE CASCADE,

  /*
   * Both languages, written when the notification is made.
   *
   * Not a translation key and some parameters: a notification is a record of
   * what somebody was told, and if the wording changes next year the row
   * should still say what it said at the time.
   */
  title_en      text        NOT NULL,
  title_ar      text        NOT NULL,
  body_en       text        NOT NULL,
  body_ar       text        NOT NULL,

  read_at       timestamptz,
  -- When the email went, or null if none was sent or none was wanted.
  emailed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_kind_known CHECK (kind IN (
    'document_expiring', 'deadline_near', 'task_assigned', 'escalation', 'time_needs_review'
  )),
  CONSTRAINT notifications_titles_present CHECK (
    length(btrim(title_en)) > 0 AND length(btrim(title_ar)) > 0
  ),
  -- One notification per person per thing. The sweep can run twice in a
  -- morning and nobody is told the same thing twice.
  CONSTRAINT notifications_once UNIQUE (user_id, kind, subject_type, subject_id)
);

-- The question the inbox asks: what is unread, newest first.
CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

/*
 * What each person wants to be told about, and how.
 *
 * A row per person per kind. No row means the default, which is in the code
 * rather than here: a default written into the schema is one nobody can change
 * without a migration.
 */
CREATE TABLE notification_preferences (
  user_id   text    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind      text    NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT false,

  PRIMARY KEY (user_id, kind),
  CONSTRAINT notification_preferences_kind_known CHECK (kind IN (
    'document_expiring', 'deadline_near', 'task_assigned', 'escalation', 'time_needs_review'
  ))
);

COMMENT ON TABLE notifications IS
  'What somebody was told. The wording is stored rather than keyed, so the row still says what it said at the time.';
