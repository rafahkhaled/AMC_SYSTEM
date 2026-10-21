-- Folders inside a client's folder.
--
-- client_files was one flat list per client. A firm keeps years of paper for
-- each client, so people need to make folders ("2025 bank statements",
-- "Audit working papers") and put files in them, several levels down.

CREATE TABLE client_folders (
  id          text        PRIMARY KEY,
  client_id   text        NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  -- Null is the top of the client's folder. A folder's parent is always in the
  -- same client; the application checks it and the composite FK below enforces it.
  parent_id   text,
  name        text        NOT NULL,
  created_by  text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Removed from view, not from existence, like files: who deleted a folder is
  -- a question with an answer.
  removed_at  timestamptz,
  removed_by  text        REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT client_folders_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT client_folders_removal_complete CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CONSTRAINT client_folders_id_client_unique UNIQUE (id, client_id),
  CONSTRAINT client_folders_parent_same_client
    FOREIGN KEY (parent_id, client_id) REFERENCES client_folders (id, client_id)
);

-- One folder of a given name per place, ignoring case. Removed ones do not count,
-- so a name can be used again after the folder that had it is gone.
CREATE UNIQUE INDEX client_folders_name_idx
  ON client_folders (client_id, coalesce(parent_id, ''), lower(name))
  WHERE removed_at IS NULL;
CREATE INDEX client_folders_client_idx ON client_folders (client_id) WHERE removed_at IS NULL;

ALTER TABLE client_files ADD COLUMN folder_id text;
ALTER TABLE client_files
  ADD CONSTRAINT client_files_folder_same_client
  FOREIGN KEY (folder_id, client_id) REFERENCES client_folders (id, client_id);
CREATE INDEX client_files_in_folder_idx ON client_files (folder_id) WHERE removed_at IS NULL;

COMMENT ON TABLE client_folders IS
  'Folders inside a client''s folder, nested. A file with a null folder_id is at the top.';
