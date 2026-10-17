-- What the whiteboard sketches asked for and the first build left out.

-- Where the client is, and the hours they keep. Hours are text "HH:MM": they
-- are a time on a clock that means the same in every timezone, not an instant.
ALTER TABLE clients
  ADD COLUMN address     text,
  ADD COLUMN opens_at    text,
  ADD COLUMN closes_at   text,
  ADD CONSTRAINT clients_opens_shape  CHECK (opens_at  IS NULL OR opens_at  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT clients_closes_shape CHECK (closes_at IS NULL OR closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT clients_hours_together CHECK ((opens_at IS NULL) = (closes_at IS NULL));

-- The number printed on the document itself: licence number, certificate
-- number, policy number. Not the same as the file name or the label.
ALTER TABLE client_documents ADD COLUMN reference_number text;

-- A portal login can carry the address of the portal, and a portal may have two
-- users (the board shows "User 1-2, Password 1-2"). A second login is a slot,
-- not a second kind: both are for the same portal.
ALTER TABLE client_credentials
  ADD COLUMN link text,
  ADD COLUMN slot smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT client_credentials_slot_known CHECK (slot IN (1, 2)),
  ADD CONSTRAINT client_credentials_link_web CHECK (link IS NULL OR link ~* '^https?://');

DROP INDEX client_credentials_current_idx;
CREATE UNIQUE INDEX client_credentials_current_idx
  ON client_credentials (client_id, kind, slot)
  WHERE retired_at IS NULL;
