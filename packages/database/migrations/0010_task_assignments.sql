-- Who is doing which task, and who was doing it before.
--
-- Append-only history rather than a column on the task. If the task simply
-- carried an assignee, reassigning it in April would silently re-attribute
-- March's hours to the new person, because the hours are reached through the
-- assignment. Closing one row and opening another keeps March true.

CREATE TABLE task_assignments (
  id            text        PRIMARY KEY,
  task_id       text        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id       text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role          text        NOT NULL DEFAULT 'responsible',
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  assigned_by   text        NOT NULL,
  unassigned_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_assignments_role_known CHECK (role IN ('responsible', 'collaborator')),
  CONSTRAINT task_assignments_dates_sane CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

-- A person cannot hold the same task twice at once, though they may have held
-- it before and be assigned again later.
CREATE UNIQUE INDEX task_assignments_live_idx
  ON task_assignments (task_id, user_id) WHERE unassigned_at IS NULL;

-- One person responsible at a time. Collaborators may be many; accountability
-- may not, or "whose task is this?" has more than one answer.
CREATE UNIQUE INDEX task_assignments_one_responsible_idx
  ON task_assignments (task_id) WHERE unassigned_at IS NULL AND role = 'responsible';

-- The workload question: what is this person carrying right now?
CREATE INDEX task_assignments_workload_idx
  ON task_assignments (user_id) WHERE unassigned_at IS NULL;

-- ON DELETE RESTRICT above is deliberate: a user who has been assigned work
-- cannot be deleted, because the hours booked under that assignment would lose
-- the person who worked them.
COMMENT ON TABLE task_assignments IS
  'Append-only. Time entries point at an assignment, so reassignment never rewrites who did past work.';
