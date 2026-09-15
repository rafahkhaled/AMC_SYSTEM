-- Renewal was impossible to write in either order, which the integration tests
-- found the first time they tried it.
--
-- The foreign key wanted the replacement to exist before the old row could
-- point at it. The unique index on live documents wanted the old row marked
-- superseded before the replacement could be inserted. Both are correct, and
-- together they left no order that worked.
--
-- Deferring the foreign key to commit time resolves it: within one transaction
-- the old row is superseded first, dropping out of the partial unique index,
-- and the replacement is inserted second. At commit both hold.

ALTER TABLE client_documents
  DROP CONSTRAINT client_documents_superseded_by_id_fkey;

ALTER TABLE client_documents
  ADD CONSTRAINT client_documents_superseded_by_id_fkey
  FOREIGN KEY (superseded_by_id) REFERENCES client_documents (id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT client_documents_superseded_by_id_fkey ON client_documents IS
  'Deferred to commit, so a renewal can supersede the old version and insert the new one in one transaction.';
