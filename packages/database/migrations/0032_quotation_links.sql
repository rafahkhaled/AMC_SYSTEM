/*
 * A link the client can open without an account (FR-30).
 *
 * The practice sends a quotation and then rings up a week later to ask
 * whether it was seen. This is the answer to both halves: the client opens a
 * page and says yes or no themselves, and the firm can see that they looked.
 *
 * Only the hash is stored, the same bargain sessions make. The token is 32
 * random bytes and carries full entropy, so a single SHA-256 is right —
 * argon2 exists to slow down guessing at human passwords and there is no
 * guessing to slow down here. A leaked backup hands over no live links.
 *
 * Reissuing overwrites the hash, which revokes the previous link. That is the
 * behaviour somebody wants when a quotation went to the wrong address.
 */
ALTER TABLE quotations
  ADD COLUMN link_token_hash  text UNIQUE,
  ADD COLUMN link_expires_at  timestamptz,
  -- When the client first opened it. Null means they never did, which is the
  -- thing worth knowing before chasing them a second time.
  ADD COLUMN link_opened_at   timestamptz,
  /*
   * Who answered.
   *
   * "The client accepted through the link" and "an accountant ticked
   * accepted" are different evidence, and the difference is the whole point
   * of sending a link. Null until somebody answers.
   */
  ADD COLUMN decided_by       text;

ALTER TABLE quotations
  ADD CONSTRAINT quotations_decided_by_known
    CHECK (decided_by IS NULL OR decided_by IN ('client', 'staff')),
  ADD CONSTRAINT quotations_link_has_an_end
    CHECK ((link_token_hash IS NULL) = (link_expires_at IS NULL));

COMMENT ON COLUMN quotations.link_token_hash IS
  'SHA-256 of the client link token. The token itself is never stored.';
