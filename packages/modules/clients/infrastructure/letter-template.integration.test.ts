import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleLetterRepository, DrizzleLetterTemplateRepository } from './letter.repository.js';

type Db = ReturnType<typeof drizzle>;

const template = (over: Record<string, unknown> = {}) => ({
  id: 'lt-1',
  code: 'salary_certificate',
  nameEn: 'Salary certificate',
  nameAr: 'شهادة راتب',
  bodyEn: 'To {{client_name}}',
  bodyAr: 'إلى {{client_name}}',
  retiredAt: null as Date | null,
  ...over,
});

describe('the firm’s letter templates, against a real database (feedback item 6)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('starts with the three the firm was given, which it can now reword', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const admin = new DrizzleLetterTemplateRepository(tx as unknown as Db);
      const codes = (await admin.all()).map((one) => one.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          'engagement_letter',
          'emaratax_authorisation',
          'vat_deregistration_request',
        ]),
      );
    });
  });

  it('adds a letter, and the generator offers it straight away', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await new DrizzleLetterTemplateRepository(db).insert(template());

      const offered = await new DrizzleLetterRepository(db).templates();
      expect(offered.map((one) => one.code)).toContain('salary_certificate');
      const found = await new DrizzleLetterRepository(db).templateByCode('salary_certificate');
      expect(found?.render('ar', { client_name: 'شركة الخليج' }).body).toBe('إلى شركة الخليج');
    });
  });

  it('takes a retired letter out of what is offered, while the admin still sees it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      const admin = new DrizzleLetterTemplateRepository(db);
      await admin.insert(template());
      await admin.update(template({ retiredAt: new Date('2026-10-12T00:00:00Z') }));

      const offered = await new DrizzleLetterRepository(db).templates();
      expect(offered.map((one) => one.code)).not.toContain('salary_certificate');
      expect((await admin.findByCode('salary_certificate'))?.retiredAt).not.toBeNull();
    });
  });

  it('rewords a letter in place, leaving its id and code', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const admin = new DrizzleLetterTemplateRepository(tx as unknown as Db);
      await admin.insert(template());
      await admin.update(template({ bodyEn: 'Reworded for {{client_name}}' }));

      const after = await admin.findByCode('salary_certificate');
      expect(after).toMatchObject({ id: 'lt-1', bodyEn: 'Reworded for {{client_name}}' });
    });
  });

  it('will not hold two letters under one code', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const admin = new DrizzleLetterTemplateRepository(tx as unknown as Db);
      await admin.insert(template());
      await expect(admin.insert(template({ id: 'lt-2' }))).rejects.toThrow();
    });
  });

  it('refuses a letter with no wording in one language, past the application', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const admin = new DrizzleLetterTemplateRepository(tx as unknown as Db);
      await expect(admin.insert(template({ bodyAr: '   ' }))).rejects.toThrow();
    });
  });
});
