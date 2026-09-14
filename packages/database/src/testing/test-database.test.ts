import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDatabase, createTestDatabase } from './test-database.js';

describe('integration test harness', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('gives each test a transaction and rolls it back afterwards', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await tx.execute('CREATE TABLE scratch (id int PRIMARY KEY)');
      await tx.execute('INSERT INTO scratch (id) VALUES (1)');
      const rows = await tx.execute('SELECT id FROM scratch');
      expect(rows).toHaveLength(1);
    });

    // The table never existed as far as the database is concerned, which is
    // what lets the suite be re-run without any cleanup step.
    const survived = await database.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'scratch'
    `;
    expect(survived[0]?.count).toBe('0');
  });

  it('returns the value the test body produced', async () => {
    const result = await database.inRollbackTransaction(async () => 'the answer');
    expect(result).toBe('the answer');
  });

  it('rolls back when the test body throws, and lets the failure through', async () => {
    await expect(
      database.inRollbackTransaction(async (tx) => {
        await tx.execute('CREATE TABLE also_scratch (id int)');
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');

    const survived = await database.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'also_scratch'
    `;
    expect(survived[0]?.count).toBe('0');
  });
});
