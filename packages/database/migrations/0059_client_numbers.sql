/*
 * Every client a number, in the order they were added, shown beside the name.
 *
 * The clients already here are numbered by when they were added; new ones take
 * the next. A deleted client's number is not given to anyone else.
 */
ALTER TABLE clients ADD COLUMN number integer;

UPDATE clients c
   SET number = ordered.n
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM clients) ordered
 WHERE ordered.id = c.id;

CREATE SEQUENCE clients_number_seq OWNED BY clients.number;
SELECT setval('clients_number_seq', coalesce((SELECT max(number) FROM clients), 0) + 1, false);

ALTER TABLE clients
  ALTER COLUMN number SET DEFAULT nextval('clients_number_seq'),
  ALTER COLUMN number SET NOT NULL;

CREATE UNIQUE INDEX clients_number_idx ON clients (number);
