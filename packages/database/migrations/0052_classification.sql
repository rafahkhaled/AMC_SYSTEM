-- Branch, salesperson and who did the work, on everything from the first
-- enquiry to the invoice, so the firm can see its business by each of them.
--
-- Set once, where the client is first written down, and carried forward: a
-- quotation, a job and an invoice for a client start with the client's values,
-- and any of them can be changed on the document itself. The carrying forward
-- is done here, in triggers, so it happens whichever screen or process creates
-- the row, and fills only what was left empty.

/*
 * The salespeople. Every employee is one, by a trigger on users; somebody from
 * outside (a broker, an agent) is added by name and has no login.
 */
CREATE TABLE salespeople (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  -- Set for an employee: their name is then read from their account, so a
  -- renamed employee is renamed here too.
  user_id     text        UNIQUE REFERENCES users (id) ON DELETE SET NULL,
  retired_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT salespeople_name_present CHECK (length(btrim(name)) > 0)
);

INSERT INTO salespeople (id, name, user_id)
SELECT 'sp-' || u.id, u.display_name, u.id
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'client'
);

CREATE FUNCTION salespeople_for_new_user() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO salespeople (id, name, user_id)
  VALUES ('sp-' || NEW.id, NEW.display_name, NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_are_salespeople AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION salespeople_for_new_user();

-- A client portal account is a user too, and never a salesperson.
CREATE FUNCTION salespeople_not_clients() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'client' THEN
    DELETE FROM salespeople WHERE user_id = NEW.user_id
      AND NOT EXISTS (SELECT 1 FROM clients WHERE salesperson_id = salespeople.id);
  END IF;
  RETURN NEW;
END;
$$;

-- The columns, on each step of the way.
ALTER TABLE clients
  ADD COLUMN branch_code    text REFERENCES branches (code) ON DELETE RESTRICT,
  ADD COLUMN salesperson_id text REFERENCES salespeople (id) ON DELETE SET NULL,
  ADD COLUMN performed_by   text REFERENCES users (id) ON DELETE SET NULL;

CREATE TRIGGER user_roles_not_salespeople AFTER INSERT ON user_roles
  FOR EACH ROW EXECUTE FUNCTION salespeople_not_clients();

ALTER TABLE leads
  ADD COLUMN branch_code    text REFERENCES branches (code) ON DELETE RESTRICT,
  ADD COLUMN salesperson_id text REFERENCES salespeople (id) ON DELETE SET NULL;

ALTER TABLE quotations
  ADD COLUMN salesperson_id text REFERENCES salespeople (id) ON DELETE SET NULL,
  ADD COLUMN performed_by   text REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN salesperson_id text REFERENCES salespeople (id) ON DELETE SET NULL,
  ADD COLUMN performed_by   text REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN branch_code    text REFERENCES branches (code) ON DELETE RESTRICT,
  ADD COLUMN salesperson_id text REFERENCES salespeople (id) ON DELETE SET NULL;

CREATE INDEX clients_branch_idx      ON clients (branch_code)      WHERE branch_code IS NOT NULL;
CREATE INDEX clients_salesperson_idx ON clients (salesperson_id)   WHERE salesperson_id IS NOT NULL;
CREATE INDEX invoices_salesperson_idx ON invoices (salesperson_id) WHERE salesperson_id IS NOT NULL;
CREATE INDEX invoices_performer_idx  ON invoices (performed_by)    WHERE performed_by IS NOT NULL;
CREATE INDEX projects_branch_idx     ON projects (branch_code)     WHERE branch_code IS NOT NULL;

/*
 * Carrying forward. Each fills only what was left empty, so a value chosen on
 * the document itself always wins.
 */

-- An enquiry that becomes a client hands over its branch and salesperson.
CREATE FUNCTION classification_from_lead() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.converted_client_id IS NOT NULL
     AND (OLD.converted_client_id IS DISTINCT FROM NEW.converted_client_id) THEN
    UPDATE clients SET
      branch_code    = coalesce(branch_code, NEW.branch_code),
      salesperson_id = coalesce(salesperson_id, NEW.salesperson_id)
    WHERE id = NEW.converted_client_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leads_hand_over_classification AFTER INSERT OR UPDATE OF converted_client_id ON leads
  FOR EACH ROW EXECUTE FUNCTION classification_from_lead();

-- A quotation starts with the client's salesperson and performer.
CREATE FUNCTION classification_for_quotation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.salesperson_id, c.salesperson_id),
         coalesce(NEW.performed_by, c.performed_by)
    INTO NEW.salesperson_id, NEW.performed_by
    FROM clients c WHERE c.id = NEW.client_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quotations_take_classification BEFORE INSERT ON quotations
  FOR EACH ROW EXECUTE FUNCTION classification_for_quotation();

-- A job starts with the client's branch and salesperson, and the client's
-- performer becomes the person responsible for it.
CREATE FUNCTION classification_for_project() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.branch_code, c.branch_code),
         coalesce(NEW.salesperson_id, c.salesperson_id)
    INTO NEW.branch_code, NEW.salesperson_id
    FROM clients c WHERE c.id = NEW.client_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_take_classification BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION classification_for_project();

CREATE FUNCTION responsible_for_new_project() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  performer text;
BEGIN
  SELECT c.performed_by INTO performer FROM clients c WHERE c.id = NEW.client_id;
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
CREATE TRIGGER projects_get_responsible AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION responsible_for_new_project();

-- An invoice starts with the client's salesperson and performer.
CREATE FUNCTION classification_for_invoice() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.salesperson_id, c.salesperson_id),
         coalesce(NEW.performed_by, c.performed_by)
    INTO NEW.salesperson_id, NEW.performed_by
    FROM clients c WHERE c.id = NEW.client_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_take_classification BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION classification_for_invoice();

-- ...and, failing the client, who was responsible for the work it bills.
CREATE FUNCTION performer_from_invoice_line() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE invoices i SET performed_by = (
    SELECT a.user_id FROM project_assignments a
    WHERE a.project_id = NEW.project_id AND a.role = 'responsible' AND a.unassigned_at IS NULL
    LIMIT 1
  )
  WHERE i.id = NEW.invoice_id AND i.performed_by IS NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_lines_name_performer AFTER INSERT ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION performer_from_invoice_line();

COMMENT ON TABLE salespeople IS
  'Who sold the work: every employee (by trigger) and anybody added by name, such as an outside agent.';
