-- Projects and Tasks, as the practice names them.
--
-- The firm's own structure, written on a whiteboard, is:
--
--   Client -> Projects -> Tasks
--
-- where a Project is one piece of work for one client ("Gulf Trading, VAT
-- return Q3 2026") and a Task is something that has to be done inside it. The
-- system was built calling the first a task and the second a task step, which
-- is the same shape under different words.
--
-- Same shape, wrong words, and wrong words cost more than they look. Every
-- conversation with the practice has to be translated on the way in and on the
-- way out, and the day somebody forgets, a requirement is implemented against
-- the wrong entity. So this renames rather than papers over:
--
--   tasks             -> projects
--   task_steps        -> tasks
--   task_assignments  -> project_assignments
--   task_documents    -> project_documents
--   *.task_id         -> *.project_id   (everywhere it pointed at a project)
--
-- Done now because it only gets more expensive: P3's AI pipeline and P7's
-- QuickBooks mapping both hang off these tables, and neither exists yet.
--
-- Renames rather than a copy, so no data moves and no foreign key is dropped.
-- Indexes, constraints and triggers are renamed too — Postgres keeps their old
-- names through a table rename, and an index called tasks_board_idx on a table
-- called projects is a trap for whoever reads it next.

-- ---------------------------------------------------------------- tables --
-- Order matters: `tasks` has to stop being `tasks` before `task_steps` can
-- take the name.
ALTER TABLE tasks             RENAME TO projects;
ALTER TABLE task_steps        RENAME TO tasks;
ALTER TABLE task_assignments  RENAME TO project_assignments;
ALTER TABLE task_documents    RENAME TO project_documents;

-- --------------------------------------------------------------- columns --
ALTER TABLE tasks               RENAME COLUMN task_id TO project_id;
ALTER TABLE project_assignments RENAME COLUMN task_id TO project_id;
ALTER TABLE project_documents   RENAME COLUMN task_id TO project_id;
ALTER TABLE client_contact_log  RENAME COLUMN task_id TO project_id;
ALTER TABLE generated_documents RENAME COLUMN task_id TO project_id;
ALTER TABLE statement_lines     RENAME COLUMN task_id TO project_id;
ALTER TABLE invoice_lines       RENAME COLUMN task_id TO project_id;

-- --------------------------------------------------------------- indexes --
ALTER INDEX tasks_pkey                        RENAME TO projects_pkey;
ALTER INDEX tasks_board_idx                   RENAME TO projects_board_idx;
ALTER INDEX tasks_client_idx                  RENAME TO projects_client_idx;
ALTER INDEX tasks_one_per_period_idx          RENAME TO projects_one_per_period_idx;
ALTER INDEX task_steps_pkey                   RENAME TO tasks_pkey;
ALTER INDEX task_assignments_pkey             RENAME TO project_assignments_pkey;
ALTER INDEX task_assignments_live_idx         RENAME TO project_assignments_live_idx;
ALTER INDEX task_assignments_one_responsible_idx
                                              RENAME TO project_assignments_one_responsible_idx;
ALTER INDEX task_assignments_workload_idx     RENAME TO project_assignments_workload_idx;
ALTER INDEX task_documents_pkey               RENAME TO project_documents_pkey;
ALTER INDEX task_documents_document_idx       RENAME TO project_documents_document_idx;

-- ----------------------------------------------------------- constraints --
ALTER TABLE projects RENAME CONSTRAINT tasks_state_known TO projects_state_known;
ALTER TABLE projects RENAME CONSTRAINT tasks_completed_has_date TO projects_completed_has_date;
ALTER TABLE projects RENAME CONSTRAINT tasks_belong_to_the_same_client
  TO projects_belong_to_the_same_client;
ALTER TABLE projects RENAME CONSTRAINT tasks_client_service_id_fkey
  TO projects_client_service_id_fkey;

ALTER TABLE tasks RENAME CONSTRAINT task_steps_task_id_fkey TO tasks_project_id_fkey;

ALTER TABLE project_assignments
  RENAME CONSTRAINT task_assignments_task_id_fkey TO project_assignments_project_id_fkey;
ALTER TABLE project_assignments
  RENAME CONSTRAINT task_assignments_user_id_fkey TO project_assignments_user_id_fkey;
ALTER TABLE project_assignments
  RENAME CONSTRAINT task_assignments_role_known TO project_assignments_role_known;
ALTER TABLE project_assignments
  RENAME CONSTRAINT task_assignments_dates_sane TO project_assignments_dates_sane;

ALTER TABLE project_documents
  RENAME CONSTRAINT task_documents_task_id_fkey TO project_documents_project_id_fkey;
ALTER TABLE project_documents
  RENAME CONSTRAINT task_documents_document_id_fkey TO project_documents_document_id_fkey;

-- -------------------------------------------------------------- triggers --
ALTER TRIGGER tasks_updated_at ON projects RENAME TO projects_updated_at;

-- -------------------------------------------------------------- comments --
COMMENT ON TABLE projects IS
  'One piece of work for one client: Gulf Trading, VAT return Q3 2026. The hub — nothing bills without a project.';
COMMENT ON TABLE tasks IS
  'Something to be done inside a project. Was task_steps.';
COMMENT ON TABLE project_assignments IS
  'Who is on a project. Append-only, so reassigning in April never rewrites who did March.';
COMMENT ON TABLE project_documents IS
  'Which documents a project needs, and which have arrived.';
