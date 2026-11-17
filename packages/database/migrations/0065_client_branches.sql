-- A licence sometimes has branches, each with a licence number of its own.
-- Kept with the client as a list: a branch is part of the client, not a
-- client of its own, and the firm bills and files for the business as one.
ALTER TABLE clients ADD COLUMN branches jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(branches) = 'array');
