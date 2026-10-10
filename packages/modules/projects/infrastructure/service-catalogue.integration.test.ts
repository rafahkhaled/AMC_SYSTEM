import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineCustomService } from '../domain/index.js';
import { DrizzleClientServiceRepository } from './client-service.repository.js';
import { DrizzleCustomServiceRepository, DrizzleServiceCatalogue } from './service-catalogue.js';

type Db = ReturnType<typeof drizzle>;

const template = (code = 'custom_trademark') => {
  const made = defineCustomService(code, {
    nameEn: 'Trademark registration',
    nameAr: 'تسجيل علامة تجارية',
    deadlineDays: 45,
    steps: [
      { nameEn: 'Search', nameAr: 'بحث' },
      { nameEn: 'File', nameAr: 'تقديم' },
    ],
    requiredDocuments: [{ type: 'trade_licence', mandatory: true }],
  });
  if (!made.ok) throw made.error;
  return made.value;
};

describe('the service catalogue, against a real database (feedback item 8)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function world(db: Db) {
    await db.execute(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ('sc-u', 'sc@activemanagement.ae', 'Admin', 'x')`,
    );
    await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('sc-c', 'Catalogue LLC')`);
  }

  it('finds the eleven without touching the table, and a custom one through it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleCustomServiceRepository(db);
      await repository.insert({
        template: template(),
        deadlineDays: 45,
        position: 0,
        createdBy: 'sc-u',
      });

      const catalogue = new DrizzleServiceCatalogue(db);
      expect((await catalogue.find('vat_return'))?.nameEn).toBe('VAT return');

      const found = await catalogue.find('custom_trademark');
      expect(found?.nameAr).toBe('تسجيل علامة تجارية');
      expect(found?.tasks.map((task) => task.nameEn)).toEqual(['Search', 'File']);
      expect(found?.deadline).toEqual({ kind: 'days_from_start', days: 45 });
      expect(found?.requiredDocuments).toEqual([{ type: 'trade_licence', mandatory: true }]);

      // Not a code anybody could have made, and not one that exists.
      expect(await catalogue.find('custom_ghost')).toBeNull();
      expect(await catalogue.find('not a code')).toBeNull();
    });
  });

  it('offers the eleven plus the live custom ones, and keeps the retired ones for labels', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleCustomServiceRepository(db);
      await repository.insert({
        template: template('custom_a'),
        deadlineDays: 45,
        position: 0,
        createdBy: 'sc-u',
      });
      await repository.insert({
        template: template('custom_b'),
        deadlineDays: 45,
        position: 1,
        createdBy: 'sc-u',
      });
      await repository.update({ template: template('custom_b'), deadlineDays: 45, retired: true });

      const catalogue = new DrizzleServiceCatalogue(db);
      const offered = (await catalogue.offered()).map((one) => one.code);
      expect(offered).toHaveLength(12);
      expect(offered).toContain('custom_a');
      // Out of the picker, so nobody opens new work under it...
      expect(offered).not.toContain('custom_b');
      // ...but still known, because projects already opened under it show its name.
      expect((await catalogue.retired()).map((one) => one.code)).toEqual(['custom_b']);
      expect(await catalogue.find('custom_b')).not.toBeNull();
    });
  });

  it('lets a client be engaged for a custom service, and for nothing made up', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const services = new DrizzleClientServiceRepository(db);

      const engaged = await services.subscribe({
        id: 'sc-cs',
        clientId: 'sc-c',
        service: 'custom_trademark',
        activeFrom: new Date('2026-10-01T00:00:00Z'),
      });
      expect(engaged.service).toBe('custom_trademark');

      // The rule that used to name the eleven now names a shape, and a typo is
      // still refused rather than quietly becoming a service.
      await expect(
        services.subscribe({
          id: 'sc-bad',
          clientId: 'sc-c',
          service: 'vat_retrun',
          activeFrom: new Date('2026-10-01T00:00:00Z'),
        }),
      ).rejects.toThrow();
    });
  });

  it('refuses a row the rules would not have written', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const insert = (code: string, steps: string) =>
        db.execute(
          `INSERT INTO custom_services (code, name_en, name_ar, steps, created_by)
           VALUES ('${code}', 'X', 'س', '${steps}'::jsonb, 'sc-u')`,
        );

      await expect(insert('custom_ok', '[{"nameEn":"a","nameAr":"أ"}]')).resolves.toBeDefined();
      // A code that is not shaped like one, and a service with no steps.
      await expect(insert('Custom Bad', '[{"nameEn":"a","nameAr":"أ"}]')).rejects.toThrow();
      await expect(insert('custom_empty', '[]')).rejects.toThrow();
    });
  });
});
