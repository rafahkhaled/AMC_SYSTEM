/*
 * Who a letter was addressed to, and who wrote it (FR-04).
 *
 * The practice prints a VAT de-registration for the FTA and an authorisation
 * for a free zone, and six months later needs to answer "what did we send
 * them, and when". The letter was stored; who it went to was not.
 *
 * A code from the same authority list the documents use, so the two answer
 * the same question the same way and an administrator maintains one list.
 */
ALTER TABLE generated_documents
  ADD COLUMN authority text;

COMMENT ON COLUMN generated_documents.authority IS
  'Code from reference_options where list = authority. Null when nobody said.';
