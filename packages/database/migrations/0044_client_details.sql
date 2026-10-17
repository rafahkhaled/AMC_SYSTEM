-- Who to contact at a client, and the numbers the firm quotes back to them.
--
-- Contact fields sit on the client itself rather than in client_contacts: this
-- is the one person the file names as "the contact", typed once, shown on the
-- client page. client_contacts stays for the people who message on WhatsApp.
ALTER TABLE clients
  ADD COLUMN contact_person  text,
  ADD COLUMN contact_email   citext,
  ADD COLUMN mobile          text,
  ADD COLUMN landline        text,
  -- 0 is Sunday and 6 is Saturday, as in JavaScript's getDay(). The weekly day
  -- off varies by business here (Friday, Saturday, Sunday), so it is data.
  ADD COLUMN weekly_day_off  smallint,
  ADD CONSTRAINT clients_day_off_range CHECK (weekly_day_off IS NULL OR weekly_day_off BETWEEN 0 AND 6);

-- Reference numbers beyond the licence and the TRN: establishment card, MOL
-- number, chamber of commerce, ejari. Named by the firm, so no fixed list.
CREATE TABLE client_references (
  client_id  text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  label      text        NOT NULL,
  value      text        NOT NULL,
  position   smallint    NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (client_id, label),
  CONSTRAINT client_references_label_present CHECK (length(btrim(label)) > 0),
  CONSTRAINT client_references_value_present CHECK (length(btrim(value)) > 0)
);

COMMENT ON TABLE client_references IS
  'Named reference numbers for a client (establishment card, MOL, chamber, ejari), beyond licence and TRN.';
