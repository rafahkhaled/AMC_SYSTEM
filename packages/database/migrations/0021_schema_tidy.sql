-- Two things the schema was missing, found by asking it rather than reading it.
--
-- 1. Foreign keys with no supporting index. Postgres does not create one, and
--    without it a delete on the parent table scans the child. That is fine on
--    a lookup table of four rows and not fine on a table that grows with every
--    hour somebody works.
--
--    Indexed here: the columns on tables that grow without bound, and the ones
--    a screen actually queries by. Deliberately not indexed: `retired_by` on
--    credentials and `contact_id` on the contact log, because those tables stay
--    small and an index nobody uses is a write cost with no reader.
--
-- 2. Comments. Most of this schema is explained at length in the migration that
--    created it, which is the wrong place to look when you have a psql prompt
--    open. Every table now says what it is from `\d+`.

-- Deleting a user must not scan the tables that name them.
CREATE INDEX IF NOT EXISTS time_entries_reviewed_by_idx
  ON time_entries (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS generated_documents_generated_by_idx
  ON generated_documents (generated_by) WHERE generated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_contact_log_user_idx
  ON client_contact_log (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_credentials_created_by_idx
  ON client_credentials (created_by) WHERE created_by IS NOT NULL;

-- Retiring a template is refused while anything points at it, which reads
-- every row of a table that grows with every letter sent.
CREATE INDEX IF NOT EXISTS generated_documents_template_idx
  ON generated_documents (template_id);

-- "What did we send this client about that task?"
CREATE INDEX IF NOT EXISTS generated_documents_task_idx
  ON generated_documents (task_id) WHERE task_id IS NOT NULL;

-- "What has this client been told?", and the cascade when one leaves.
CREATE INDEX IF NOT EXISTS notifications_client_idx
  ON notifications (client_id) WHERE client_id IS NOT NULL;

-- Unassigning somebody from a task has to find their running timer.
CREATE INDEX IF NOT EXISTS running_timers_assignment_idx
  ON running_timers (assignment_id);

-- Following a renewal chain backwards: "what replaced this licence?"
CREATE INDEX IF NOT EXISTS client_documents_superseded_by_idx
  ON client_documents (superseded_by_id) WHERE superseded_by_id IS NOT NULL;

-- Every table says what it is.
COMMENT ON TABLE users IS
  'Everyone who signs in, staff and portal clients alike. The role says which.';
COMMENT ON TABLE user_roles IS
  'Which roles a person holds. A list rather than a column, because somebody can hold more than one.';
COMMENT ON TABLE sessions IS
  'Signed-in sessions. Both an idle and an absolute limit, because one covers the unattended laptop and the other the session kept alive by activity.';
COMMENT ON TABLE clients IS
  'The companies the practice acts for. Tax periods are staggered per client, which is why the period months live here and not in a constant.';
COMMENT ON TABLE client_contacts IS
  'The people at a client. What was said to them is in client_contact_log.';
COMMENT ON TABLE client_staff_access IS
  'Which staff may reach which clients. Read by every module, so the predicate is defined once in @amc/database.';
COMMENT ON TABLE client_rates IS
  'Effective-dated hourly rates. Never updated in place: the rate that applied in March is what March is billed at.';
COMMENT ON TABLE client_documents IS
  'The document repository per client. Expiry is deliberately not a status column: it is a fact about a date, and a column would need something nightly to keep it true.';
COMMENT ON TABLE client_services IS
  'What each client has subscribed to. Tasks are created from these against the service template.';
COMMENT ON TABLE tasks IS
  'One piece of work. The link between a client and the documents that work needs.';
COMMENT ON TABLE task_steps IS
  'Progress through the service template''s checklist, one row per step.';
COMMENT ON TABLE task_documents IS
  'Which of the client''s documents satisfy this task''s requirements.';
COMMENT ON TABLE time_entries IS
  'Recorded work, always against an assignment rather than a person, so a later reassignment cannot rewrite who did it.';
COMMENT ON TABLE leads IS
  'Enquiries, before they are clients. Kept after conversion so "where did this client come from?" has an answer.';
COMMENT ON TABLE document_templates IS
  'The firm''s letters, in both languages, with {{placeholders}}. Editable without a deployment.';
COMMENT ON TABLE notification_preferences IS
  'What each person wants to be told about, and how. No row means the default, which lives in the code.';
COMMENT ON TABLE user_working_hours IS
  'When each person is expected to be working, in Dubai. A default rather than a rule: plenty of practices here work Sunday to Thursday.';
COMMENT ON TABLE contact_log_attachments IS
  'Screenshots of conversations. A separate table because a WhatsApp thread is several images and a call is none.';
COMMENT ON TABLE outbox IS
  'Domain events waiting to be published, written in the same transaction as the change they describe.';
COMMENT ON TABLE schema_migrations IS
  'Which migrations have run. Written under an advisory lock taken before anything is created.';
