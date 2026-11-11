/*
 * Client numbers without gaps.
 *
 * A deleted client left a hole, so the list began at 3 after the first two
 * test clients went. The firm wants the numbers to run 1, 2, 3 whatever was
 * deleted: they are a count of the book, not a reference anybody quotes.
 * Closed up here once, kept closed by the delete itself from now on.
 */
UPDATE clients c
   SET number = -ordered.n
  FROM (SELECT id, row_number() OVER (ORDER BY number, created_at, id) AS n FROM clients) ordered
 WHERE ordered.id = c.id;
UPDATE clients SET number = -number;

SELECT setval('clients_number_seq', coalesce((SELECT max(number) FROM clients), 0) + 1, false);
