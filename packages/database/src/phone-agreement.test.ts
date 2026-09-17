import { toE164 } from '@amc/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDatabase, createTestDatabase } from './testing/index.js';

/**
 * The phone rule exists twice, and this is what stops it becoming two rules.
 *
 * `toE164` in the kernel reduces an inbound WhatsApp number so it can be looked
 * up. `e164` in migration 0023 reduces a stored number so the column can be
 * indexed. If they ever disagree about one number, that client's messages stop
 * matching them and nothing anywhere reports an error — the conversation simply
 * arrives with no client attached, which looks exactly like a stranger writing
 * in.
 *
 * So rather than a shared list of examples, which only covers what somebody
 * thought of, this builds every number out of its parts and asks Postgres about
 * all of them at once.
 */

function everyShapeOfNumber(): string[] {
  const inputs = new Set<string>();

  const mobilePrefixes = ['50', '52', '54', '55', '56', '58'];
  // 51, 53, 57 and 59 are not issued; 59 in particular looks plausible and is
  // not, which is the sort of thing one implementation gets right alone.
  const notIssued = ['51', '53', '57', '59'];
  const areaCodes = ['2', '3', '4', '6', '7', '9'];
  const notAreaCodes = ['1', '8', '0'];

  const wrap = (national: string): string[] => [
    national,
    `0${national}`,
    `971${national}`,
    `+971${national}`,
    `00971${national}`,
    `+971 ${national}`,
    `0${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`,
    `0${national}-x`,
    ` 0${national} `,
    `(0${national})`,
  ];

  for (const prefix of [...mobilePrefixes, ...notIssued]) {
    // The right length, one short, and one long. Length is where a rule that
    // was written from memory rather than from the numbering plan goes wrong.
    for (const rest of ['1234567', '123456', '12345678']) {
      for (const shape of wrap(`${prefix}${rest}`)) inputs.add(shape);
    }
  }

  for (const code of [...areaCodes, ...notAreaCodes]) {
    for (const rest of ['2345678', '234567', '23456789']) {
      for (const shape of wrap(`${code}${rest}`)) inputs.add(shape);
    }
  }

  // Foreign numbers, which pass through on length alone.
  for (const foreign of [
    '+966501234567',
    '+44 20 7946 0958',
    '+1 (415) 555-0123',
    '004420794609',
    '+20 100 123 4567',
    '+1234',
    '+1234567890123456',
  ]) {
    inputs.add(foreign);
  }

  // Arabic-Indic and Persian digits, both of which reach a form on a phone.
  inputs.add('٠٥٠١٢٣٤٥٦٧');
  inputs.add('۰۵۰۱۲۳۴۵۶۷');
  inputs.add('+٩٧١٥٠١٢٣٤٥٦٧');
  inputs.add('٠٤٢٣٤٥٦٧٨');

  // Things that are not numbers at all, and things that are nearly numbers.
  for (const junk of [
    '',
    '   ',
    '-',
    '+',
    'n/a',
    'ask reception',
    '050 123 4567 ext 9',
    'x',
    '0',
    '00',
    '+0',
    '971',
    '0971501234567',
    '9710501234567',
  ]) {
    inputs.add(junk);
  }

  return [...inputs];
}

describe('the phone rule, in TypeScript and in SQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('gives the same answer for every shape a number arrives in', async () => {
    const inputs = everyShapeOfNumber();

    const rows = await database.sql<{ raw: string; reduced: string | null }[]>`
      SELECT raw, e164(raw) AS reduced
      FROM unnest(${database.sql.array(inputs)}::text[]) AS raw
    `;

    const disagreements = rows
      .map((row) => ({ raw: row.raw, sql: row.reduced, ts: toE164(row.raw) }))
      .filter((row) => row.sql !== row.ts);

    // Named rather than counted, because the useful thing when this fails is
    // which number the two disagree about.
    expect(disagreements).toEqual([]);
    expect(rows).toHaveLength(inputs.length);
  });

  it('reduces to something, not to nothing, for the numbers that matter', async () => {
    // A guard against both implementations agreeing that everything is NULL,
    // which would pass the test above and be entirely useless.
    const [row] = await database.sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM unnest(${database.sql.array(everyShapeOfNumber())}::text[]) AS raw
      WHERE e164(raw) IS NOT NULL
    `;
    expect(Number(row?.count ?? 0)).toBeGreaterThan(100);
  });
});

describe('the generated column', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('fills itself in, whoever writes the row', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO clients (id, legal_name, status)
        VALUES ('phone-c1', 'Phone Test', 'active')
      `);
      await tx.execute(`
        INSERT INTO client_contacts (id, client_id, name, phone)
        VALUES ('phone-k1', 'phone-c1', 'Layla', '050 123 4567')
      `);

      const rows = await tx.execute<{ phone_e164: string | null }>(
        `SELECT phone_e164 FROM client_contacts WHERE id = 'phone-k1'`,
      );
      expect(rows[0]?.phone_e164).toBe('+971501234567');
    });
  });

  it('refuses to be written directly, which is what keeps it honest', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO clients (id, legal_name, status)
        VALUES ('phone-c2', 'Phone Test', 'active')
      `);
      await expect(
        tx.execute(`
          INSERT INTO client_contacts (id, client_id, name, phone, phone_e164)
          VALUES ('phone-k2', 'phone-c2', 'Omar', '050 123 4567', '+971000000000')
        `),
      ).rejects.toThrow();
    });
  });

  it('follows the number when it is corrected', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO clients (id, legal_name, status)
        VALUES ('phone-c3', 'Phone Test', 'active')
      `);
      await tx.execute(`
        INSERT INTO client_contacts (id, client_id, name, phone)
        VALUES ('phone-k3', 'phone-c3', 'Sara', '050 123 4567')
      `);
      await tx.execute(`UPDATE client_contacts SET phone = '055 765 4321' WHERE id = 'phone-k3'`);

      const rows = await tx.execute<{ phone_e164: string | null }>(
        `SELECT phone_e164 FROM client_contacts WHERE id = 'phone-k3'`,
      );
      expect(rows[0]?.phone_e164).toBe('+971557654321');
    });
  });

  it('leaves an unreadable number null rather than guessing', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO clients (id, legal_name, status)
        VALUES ('phone-c4', 'Phone Test', 'active')
      `);
      await tx.execute(`
        INSERT INTO client_contacts (id, client_id, name, phone)
        VALUES ('phone-k4', 'phone-c4', 'Reception', 'ask reception')
      `);

      const rows = await tx.execute<{ phone_e164: string | null }>(
        `SELECT phone_e164 FROM client_contacts WHERE id = 'phone-k4'`,
      );
      expect(rows[0]?.phone_e164).toBeNull();
    });
  });
});
