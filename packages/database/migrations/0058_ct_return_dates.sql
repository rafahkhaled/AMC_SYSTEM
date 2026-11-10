/*
 * The corporation tax return: when it has to be filed, and when the firm
 * filed it. Typed by hand from the authority's portal, because the due date
 * there is the one that counts, whatever the financial year suggests.
 */
ALTER TABLE clients
  ADD COLUMN ct_return_due_on   date,
  ADD COLUMN ct_return_filed_on date;
