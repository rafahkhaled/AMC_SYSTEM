-- Who did the work belongs to the job, not the client.
--
-- The firm: one company can be worked on by every one of us, depending on the
-- service. So the person is chosen when a job is opened, and a client no
-- longer carries one. clients.performed_by stays as a column (old reports
-- read it) but nothing new is drawn from it.

-- A new job with nobody responsible takes whoever was responsible for the
-- client's last job of the same service: next quarter's VAT return goes to
-- whoever did this quarter's, and a new service starts with nobody.
CREATE OR REPLACE FUNCTION responsible_for_new_project() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  performer text;
BEGIN
  SELECT a.user_id INTO performer
    FROM projects p
    JOIN project_assignments a ON a.project_id = p.id AND a.role = 'responsible'
    JOIN users u ON u.id = a.user_id AND u.status = 'active'
   WHERE p.client_id = NEW.client_id AND p.service = NEW.service AND p.id <> NEW.id
   ORDER BY p.created_at DESC, a.assigned_at DESC
   LIMIT 1;
  IF performer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = NEW.id AND role = 'responsible' AND unassigned_at IS NULL
  ) THEN
    INSERT INTO project_assignments (id, project_id, user_id, role, assigned_by)
    VALUES (gen_random_uuid()::text, NEW.id, performer, 'responsible', performer)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- A quotation no longer inherits a performer from the client; it is set on
-- the quotation itself when the firm wants one.
CREATE OR REPLACE FUNCTION classification_for_quotation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.salesperson_id, c.salesperson_id)
    INTO NEW.salesperson_id
    FROM clients c WHERE c.id = NEW.client_id;
  RETURN NEW;
END;
$$;

-- An invoice's performer is the person responsible for the jobs it bills:
-- the one whose jobs carry the most hours on its statement.
CREATE OR REPLACE FUNCTION classification_for_invoice() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.salesperson_id, c.salesperson_id)
    INTO NEW.salesperson_id
    FROM clients c WHERE c.id = NEW.client_id;
  IF NEW.performed_by IS NULL THEN
    SELECT a.user_id INTO NEW.performed_by
      FROM statement_lines l
      JOIN project_assignments a
        ON a.project_id = l.project_id AND a.role = 'responsible' AND a.unassigned_at IS NULL
     WHERE l.statement_id = NEW.statement_id AND NOT l.excluded
     GROUP BY a.user_id
     ORDER BY sum(l.worked_seconds) DESC
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
