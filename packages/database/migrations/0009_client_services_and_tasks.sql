-- What a client has subscribed to, and the work it produces.

CREATE TABLE client_services (
  id           text        PRIMARY KEY,
  client_id    text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  service      text        NOT NULL,
  active_from  date        NOT NULL DEFAULT CURRENT_DATE,
  active_to    date,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_services_known CHECK (service IN (
    'ct_registration', 'vat_registration', 'vat_return', 'ct_return',
    'tax_profile_update', 'deregistration', 'vat_refund', 'penalty_waiver',
    'emaratax_request', 'monthly_accounting', 'audit'
  )),
  CONSTRAINT client_services_dates_sane CHECK (active_to IS NULL OR active_to > active_from)
);

-- One live subscription per service per client. A second would produce two
-- sets of recurring tasks for the same work.
CREATE UNIQUE INDEX client_services_live_idx
  ON client_services (client_id, service) WHERE active_to IS NULL;

CREATE TRIGGER client_services_updated_at BEFORE UPDATE ON client_services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
  id                text        PRIMARY KEY,
  client_service_id text        NOT NULL REFERENCES client_services (id) ON DELETE CASCADE,
  -- Reachable through the subscription, but carried here too: scoping and the
  -- board query hit it constantly. The composite key below stops it drifting.
  client_id         text        NOT NULL,
  service           text        NOT NULL,
  -- Which period this instance covers. Null for work that happens once.
  period_key        text,
  state             text        NOT NULL DEFAULT 'awaiting_documents',
  due_at            timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_state_known CHECK (state IN (
    'awaiting_documents', 'ready', 'in_progress',
    'waiting_for_client', 'waiting_for_authority', 'completed', 'cancelled'
  )),
  CONSTRAINT tasks_completed_has_date CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

-- The client on a task must be the client on its subscription. Enforced by a
-- composite key rather than a trigger, so it cannot drift even by hand.
ALTER TABLE client_services ADD CONSTRAINT client_services_id_client_key UNIQUE (id, client_id);
ALTER TABLE tasks ADD CONSTRAINT tasks_belong_to_the_same_client
  FOREIGN KEY (client_service_id, client_id)
  REFERENCES client_services (id, client_id) ON DELETE CASCADE;

/*
 * One task per subscription per period (FR-14).
 *
 * This is what makes the recurrence engine safe to run twice, or to replay
 * after an outage: a second attempt at the same quarter inserts nothing.
 */
CREATE UNIQUE INDEX tasks_one_per_period_idx
  ON tasks (client_service_id, period_key) WHERE period_key IS NOT NULL;

CREATE INDEX tasks_board_idx ON tasks (state, due_at) WHERE state NOT IN ('completed', 'cancelled');
CREATE INDEX tasks_client_idx ON tasks (client_id, state);

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The template's document requirements, and which client document meets each.
-- This is the join that makes a task the link between a client and their files.
CREATE TABLE task_documents (
  task_id     text        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  type        text        NOT NULL,
  mandatory   boolean     NOT NULL DEFAULT true,
  document_id text        REFERENCES client_documents (id) ON DELETE SET NULL,
  attached_at timestamptz,
  attached_by text,

  PRIMARY KEY (task_id, type)
);

CREATE INDEX task_documents_document_idx ON task_documents (document_id)
  WHERE document_id IS NOT NULL;

CREATE TABLE task_steps (
  task_id text    NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  "order" integer NOT NULL,
  done_at timestamptz,

  PRIMARY KEY (task_id, "order")
);

COMMENT ON TABLE task_documents IS
  'A task reaches exactly the right documents of its own client, never the whole repository.';
