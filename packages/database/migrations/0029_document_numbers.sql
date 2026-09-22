-- One running number per document kind, continuing the firm's own sequence.
--
-- The firm's last invoice was 2070 and its last quotation 192, written by hand
-- for years. A system that restarts at 1 leaves their files holding two
-- numbering schemes, and an auditor asking why invoice 1 was issued after
-- invoice 2070 gets an answer nobody wants to give.
--
-- So: plain running integers, continuing where they are. No year in the
-- number, because theirs has never had one and the sequence is the record.
--
-- Replaces `invoice_numbers` from 0027, which was per-year and formatted
-- INV-2026-0001. That table is days old and holds nothing worth keeping.

DROP TABLE IF EXISTS invoice_numbers;

CREATE TABLE document_numbers (
  kind       text        PRIMARY KEY,
  next_value integer     NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT document_numbers_kind_known CHECK (kind IN ('invoice', 'quotation')),
  CONSTRAINT document_numbers_positive CHECK (next_value > 0)
);

/*
 * Seeded one past the last number issued by hand.
 *
 * Check these against the firm's own records before the first real document
 * goes out: the value here is taken from the templates supplied in September
 * 2026 (invoice 2070, quotation 192), and anything issued by hand since then
 * would collide. Correcting it is an UPDATE; a collision is two documents
 * under one number in a client's file.
 */
INSERT INTO document_numbers (kind, next_value) VALUES
  ('invoice', 2071),
  ('quotation', 193);

COMMENT ON TABLE document_numbers IS
  'The firm''s running document sequences, continuing the numbers it issued by hand. Allocated by the database: a number handed out twice cannot be undone.';
