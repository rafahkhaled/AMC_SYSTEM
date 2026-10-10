-- A folder of files for every client.
--
-- client_documents holds the paperwork the practice chases: typed, dated,
-- renewed, and limited to what an authority accepts. This holds everything
-- else somebody wants kept with the client — a spreadsheet they sent, a Word
-- draft, a zip of bank statements — with no type, no expiry and no checklist.
-- Kept apart on purpose: a project's document checklist must never be able to
-- pick one of these up, and a trade licence must never be buried among them.

CREATE TABLE client_files (
  id            text        PRIMARY KEY,
  -- RESTRICT, like documents: deleting a client must not quietly take with it
  -- the files the firm was holding for them.
  client_id     text        NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,

  -- Derived by the storage package from ids this system owns, never from the
  -- upload. Only the key is here; the bytes are in the document store.
  storage_key   text        NOT NULL,
  -- What the person called it. Display only: it is a name somebody else chose.
  original_name text        NOT NULL,
  content_type  text        NOT NULL,
  checksum      text        NOT NULL,
  size_bytes    bigint      NOT NULL,

  uploaded_by   text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),

  -- Removed from the folder, not from existence. The row and the bytes stay,
  -- so "who deleted the engagement letter, and when" has an answer.
  removed_at    timestamptz,
  removed_by    text        REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT client_files_name_present CHECK (length(btrim(original_name)) > 0),
  CONSTRAINT client_files_size_positive CHECK (size_bytes > 0),
  -- Removed means somebody removed it, and the other way round.
  CONSTRAINT client_files_removal_complete CHECK (
    (removed_at IS NULL) = (removed_by IS NULL)
  )
);

-- The folder: what is still in it, newest first.
CREATE INDEX client_files_folder_idx ON client_files (client_id, uploaded_at DESC)
  WHERE removed_at IS NULL;
CREATE INDEX client_files_uploaded_by_idx ON client_files (uploaded_by);

COMMENT ON TABLE client_files IS
  'Any file kept with a client, typed or not. Separate from client_documents, which holds the dated paperwork the practice chases.';
