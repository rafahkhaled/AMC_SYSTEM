/*
 * Deleting a member of staff, so their email address can be used again.
 *
 * Somebody with no history is deleted outright. Somebody with recorded hours,
 * quotations or invoices cannot be: the database refuses to delete the row
 * while their assignments, and so their hours, or their invoices point at it, and the
 * firm has to be able to say who did the work it billed. Their account is
 * removed instead: the address is released, they cannot sign in, and they
 * leave every list, while their past work keeps their name.
 */
ALTER TABLE users ADD COLUMN removed_at timestamptz;
