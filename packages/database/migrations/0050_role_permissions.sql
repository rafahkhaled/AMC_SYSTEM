-- What each role may do, as the firm chooses.
--
-- The permissions themselves stay in code: each one is a check somewhere, and
-- a permission with no check behind it would be a tick box that does nothing.
-- What is data is which of them an accountant or a data-entry clerk holds. A
-- role with no row here keeps the defaults from the requirements. One row per
-- role, holding the whole choice, so "none of them" is a choice and not the
-- absence of one.
CREATE TABLE role_permission_choices (
  role        text        PRIMARY KEY,
  permissions text[]      NOT NULL,
  updated_by  text        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- The manager's are not editable (that would let one click lock everyone
  -- out) and the client's are the portal itself.
  CONSTRAINT role_permission_choices_editable CHECK (role IN ('accountant', 'data_entry'))
);

COMMENT ON TABLE role_permission_choices IS
  'The firm''s choice of grantable permissions for an editable role. No row means the defaults.';
