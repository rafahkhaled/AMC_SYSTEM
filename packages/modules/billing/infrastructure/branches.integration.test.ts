import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invoice, Quotation } from '../domain/index.js';
import { DrizzleBillingReader } from './billing.reader.js';
import { DrizzleInvoiceRepository } from './invoice.repository.js';
import { DrizzleQuotationRepository } from './quotation.repository.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-10-10T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');
const ALL = { kind: 'all' } as const;

/**
 * Branches against a real database (feedback item 12b).
 *
 * The migration seeds Dubai and Ajman, so these rely on them being there — which
 * is also the thing worth knowing: a database that migrated without them would
 * leave the firm with nothing to choose between on its first morning.
 */
describe('documents and their branches, against a real database', () => {
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
       VALUES ('br-u', 'br@activemanagement.ae', 'Wael Ajam', 'x')`,
    );
    await db.execute(`INSERT INTO clients (id, legal_name) VALUES ('br-c', 'Gulf Trading LLC')`);
  }

  function quotation(branchCode: string | null) {
    const made = Quotation.draft({
      id: 'br-q',
      clientId: 'br-c',
      reference: 'BR-1',
      currency: 'AED',
      createdBy: 'br-u',
      branchCode,
      now: NOW,
    });
    if (!made.ok) throw made.error;
    made.value.addLine({
      id: 'br-ql',
      serviceCode: null,
      descriptionEn: 'Work',
      descriptionAr: 'عمل',
      pricing: { kind: 'fixed', amount: aed(1000) },
      discount: aed(0),
      vatBasisPoints: null,
    });
    return made.value;
  }

  it('starts with the two branches the firm has, and nothing in their addresses yet', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      const rows = await db.execute<{ code: string; addresses: unknown }>(
        'SELECT code, addresses FROM branches ORDER BY position' as never,
      );
      expect(rows.map((row) => row.code)).toEqual(['dubai', 'ajman']);
      // Empty, so documents fall back to the firm-wide addresses until filled in.
      expect(rows.every((row) => Array.isArray(row.addresses) && row.addresses.length === 0)).toBe(
        true,
      );
    });
  });

  it('keeps the branch on a quotation and reads it back as a letterhead', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(
        `UPDATE branches SET addresses = '["Ajman: Free Zone, Office 12"]'::jsonb,
           bank_account_holder = 'Active M Consultancy - Ajman', bank_iban = 'AE00AJMAN',
           logo_url = 'https://example.test/ajman.png' WHERE code = 'ajman'` as never,
      );
      await new DrizzleQuotationRepository(db).save(quotation('ajman'));

      const [view] = await new DrizzleBillingReader(db).quotations(ALL, null);
      expect(view?.branch).toEqual({
        code: 'ajman',
        nameEn: 'Ajman Branch',
        nameAr: 'فرع عجمان',
        addresses: ['Ajman: Free Zone, Office 12'],
        bank: { accountHolder: 'Active M Consultancy - Ajman', iban: 'AE00AJMAN', bic: null },
        logoUrl: 'https://example.test/ajman.png',
        stampUrl: null,
        retired: false,
      });
    });
  });

  it('reads a quotation with no branch as the firm-wide letterhead', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await new DrizzleQuotationRepository(db).save(quotation(null));

      const [view] = await new DrizzleBillingReader(db).quotations(ALL, null);
      expect(view?.branch).toBeNull();
    });
  });

  it('moves a draft to another branch', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleQuotationRepository(db);
      await repository.save(quotation('dubai'));

      const draft = await repository.findById('br-q');
      draft?.setBranch('ajman', NOW);
      if (draft) await repository.save(draft);

      expect((await repository.findById('br-q'))?.snapshot().branchCode).toBe('ajman');
    });
  });

  it('refuses a branch that is not in the table, past the application', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await expect(new DrizzleQuotationRepository(db).save(quotation('sharjah'))).rejects.toThrow();
    });
  });

  it('keeps an invoice on the branch it was issued under, even after the branch is retired', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // Satisfies the invoice's statement reference.
      await db.execute(
        `INSERT INTO statements
           (id, client_id, period_start, period_end, state, currency, created_by, approved_by, approved_at)
         VALUES ('br-s', 'br-c', '2026-09-01', '2026-09-30', 'invoiced', 'AED', 'br-u', 'br-u', now())` as never,
      );
      await db.execute(
        `INSERT INTO client_services (id, client_id, service, active_from)
         VALUES ('br-cs', 'br-c', 'vat_return', '2026-01-01')` as never,
      );
      await db.execute(
        `INSERT INTO projects (id, client_service_id, client_id, service, state)
         VALUES ('br-p', 'br-cs', 'br-c', 'vat_return', 'in_progress')` as never,
      );

      const raised = Invoice.raise({
        id: 'br-i',
        clientId: 'br-c',
        statementId: 'br-s',
        number: '2071',
        branchCode: 'dubai',
        currency: 'AED',
        lines: [
          {
            id: 'br-il',
            projectId: 'br-p',
            service: 'vat_return',
            descriptionEn: 'VAT return',
            descriptionAr: 'إقرار',
            worked: { seconds: 7200 } as never,
            amount: aed(60_000),
            quantityCenti: 100,
            unitRate: aed(60_000),
          },
        ],
        vatBasisPoints: 500,
        issuedOn: NOW,
        dueOn: new Date('2026-11-10T08:00:00.000Z'),
        issuedBy: 'br-u',
      });
      if (!raised.ok) throw raised.error;
      await new DrizzleInvoiceRepository(db).save(raised.value);

      // The firm closes its Dubai branch.
      await db.execute(`UPDATE branches SET retired_at = now() WHERE code = 'dubai'` as never);

      const view = await new DrizzleBillingReader(db).invoice('br-i', ALL);
      // Still printed as Dubai: a document that lost its letterhead because
      // somebody tidied the list would be a different document.
      expect(view?.branch).toMatchObject({ code: 'dubai', retired: true });
    });
  });

  it('will not accept half a bank account, or a branch with no Arabic name', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      // An IBAN with nobody to say whose it is.
      await expect(
        db.execute(`UPDATE branches SET bank_iban = 'AE00' WHERE code = 'dubai'` as never),
      ).rejects.toThrow();
    });
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await expect(
        db.execute(
          `INSERT INTO branches (code, name_en, name_ar) VALUES ('x', 'X', '  ')` as never,
        ),
      ).rejects.toThrow();
    });
  });
});
