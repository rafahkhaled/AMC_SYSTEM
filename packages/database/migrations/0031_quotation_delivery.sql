/*
 * How a quotation reached the client.
 *
 * `sent` used to mean only that somebody pressed a button: the state changed,
 * an event was recorded that nothing subscribed to, and nothing left the
 * building. A screen that says "with the client" when the client has heard
 * nothing is worse than one that says nothing at all, because the firm stops
 * chasing.
 *
 * Null while it is a draft. `by_hand` is a real answer and not a failure —
 * printing the sheet and handing it over is how half of these go out — but it
 * is a different claim from "we emailed it", and the difference matters when
 * somebody asks a fortnight later whether the client ever saw it.
 */
ALTER TABLE quotations
  ADD COLUMN sent_via text;

/*
 * Everything already sent went by hand.
 *
 * Nothing in the system had ever emailed a quotation — `send` changed a state
 * and recorded an event nobody subscribed to — so `by_hand` is not a guess.
 * It is the only thing that can have happened, and writing it down is what
 * lets the constraint below hold for the rows that are already here.
 */
UPDATE quotations SET sent_via = 'by_hand' WHERE sent_at IS NOT NULL;

ALTER TABLE quotations
  ADD CONSTRAINT quotations_sent_via_known
    CHECK (sent_via IS NULL OR sent_via IN ('email', 'by_hand')),
  ADD CONSTRAINT quotations_sent_has_channel
    CHECK (sent_at IS NULL OR sent_via IS NOT NULL);

COMMENT ON COLUMN quotations.sent_via IS
  'How it reached the client: email, or by_hand when somebody printed it.';
