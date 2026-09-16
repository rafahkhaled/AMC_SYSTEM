-- What the system has already told somebody about.
--
-- Without this, a daily sweep would raise the same ninety-day warning every
-- day for ninety days. One row per thing per stage is what turns a sweep that
-- runs continuously into a reminder that arrives once.

CREATE TABLE raised_alerts (
  id           text        PRIMARY KEY,
  -- What the alert is about: a document, a task, a deadline.
  subject_type text        NOT NULL,
  subject_id   text        NOT NULL,
  -- Which rung of the ladder: 90, 60, 30, client_reminder, manager_alert.
  stage        text        NOT NULL,
  client_id    text        REFERENCES clients (id) ON DELETE CASCADE,
  raised_at    timestamptz NOT NULL DEFAULT now(),
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT raised_alerts_subject_present CHECK (
    length(btrim(subject_type)) > 0 AND length(btrim(subject_id)) > 0
  )
);

/*
 * Once per subject per stage, for ever.
 *
 * This is the constraint that makes the sweep idempotent: it can run twice in
 * a morning, or catch up after a week of downtime, and nobody receives the
 * same warning twice. The sweep does not have to remember what it did, because
 * the table does.
 */
CREATE UNIQUE INDEX raised_alerts_once_idx ON raised_alerts (subject_type, subject_id, stage);

CREATE INDEX raised_alerts_client_idx ON raised_alerts (client_id, raised_at DESC);
CREATE INDEX raised_alerts_recent_idx ON raised_alerts (raised_at DESC);

COMMENT ON TABLE raised_alerts IS
  'One row per subject per stage. What makes a daily sweep produce one reminder rather than ninety.';
