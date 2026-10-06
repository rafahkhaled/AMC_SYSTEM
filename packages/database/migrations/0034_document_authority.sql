/*
 * Who issued the document (FR-04).
 *
 * A trade licence from the DED and one from a free zone authority are the
 * same type of document and not the same document, and the difference decides
 * who a renewal is chased with. The practice was holding that in people's
 * heads.
 *
 * A plain code rather than a foreign key, matching how `type` is already
 * held: the options live in reference_options and are editable, and a
 * document filed under an authority somebody later retires has to keep
 * reading correctly. A foreign key would either block the retirement or
 * cascade the history away.
 */
ALTER TABLE client_documents
  ADD COLUMN authority text;

COMMENT ON COLUMN client_documents.authority IS
  'Code from reference_options where list = authority. Null when nobody said.';
