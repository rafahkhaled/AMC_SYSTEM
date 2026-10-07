import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Money } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Quotation, type QuotationLine } from '../domain/index.js';
import { DrizzleQuotationRepository } from './quotation.repository.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-09-21T08:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash)
    VALUES ('q-u1', 'wael@activemanagement.ae', 'Wael Ajam', 'x')
  `);
  await db.execute(`
    INSERT INTO clients (id, legal_name, status)
    VALUES ('q-c1', 'Gulf Trading LLC', 'active')
  `);
}

function drafted(over: Partial<Parameters<typeof Quotation.draft>[0]> = {}): Quotation {
  const made = Quotation.draft({
    id: 'q-1',
    clientId: 'q-c1',
    reference: 'Q-2026-014',
    currency: 'AED',
    createdBy: 'q-u1',
    validUntil: days(30),
    now: NOW,
    ...over,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

/**
 * A line with nothing special about it.
 *
 * The parts the round trip is actually about — the service, the discount, the
 * VAT rate — are passed in by the tests that care; everything else defaults
 * to the plainest line there is.
 */
function line(over: Partial<QuotationLine> & Pick<QuotationLine, 'id'>): QuotationLine {
  return {
    serviceCode: null,
    descriptionEn: 'Work',
    descriptionAr: 'عمل',
    pricing: { kind: 'fixed', amount: aed(1000) },
    discount: aed(0),
    vatBasisPoints: null,
    ...over,
  };
}

describe('quotations, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  /*
   * The service, the discount and the rate (feedback item 13).
   *
   * Worth a real database rather than the in-memory double: the discount is
   * capped by a check constraint as well as by the aggregate, and an
   * out-of-scope line is a null the driver has to carry back as a null rather
   * than as a zero.
   */
  it('keeps the service, the discount and the rate a line was quoted at', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const quotation = drafted();
      quotation.addLine(
        line({
          id: 'q-l1',
          serviceCode: 'vat_return',
          pricing: { kind: 'fixed', amount: aed(500_000) },
          discount: aed(50_000),
          vatBasisPoints: 500,
        }),
      );
      quotation.addLine(line({ id: 'q-l2', pricing: { kind: 'fixed', amount: aed(100_000) } }));

      const repository = new DrizzleQuotationRepository(db);
      await repository.save(quotation);

      const back = await repository.findById('q-1');
      const lines = back?.snapshot().lines ?? [];

      expect(lines[0]?.serviceCode).toBe('vat_return');
      expect(lines[0]?.discount.minorUnits).toBe(50_000);
      expect(lines[0]?.vatBasisPoints).toBe(500);
      // Out of scope comes back as out of scope, not as zero percent.
      expect(lines[1]?.serviceCode).toBeNull();
      expect(lines[1]?.vatBasisPoints).toBeNull();

      expect(back?.net().minorUnits).toBe(550_000);
      expect(back?.vatTotal().minorUnits).toBe(22_500);
      expect(back?.total().minorUnits).toBe(572_500);
    });
  });

  it('refuses a discount larger than the line, in the database as well', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      /*
       * Written straight to the table, past the aggregate.
       *
       * The domain refuses this already. The constraint is there for
       * everything that is not the domain — a migration, a repair script, a
       * psql session at four in the afternoon — because a line charging less
       * than nothing turns a quotation into something that reads as a credit
       * note.
       */
      await db.execute(`
        INSERT INTO quotations (id, client_id, reference, state, currency, created_by)
        VALUES ('q-bad', 'q-c1', 'Q-BAD', 'draft', 'AED', 'q-u1')
      `);

      const insert = (position: number, discountMinor: number) =>
        db.execute(`
          INSERT INTO quotation_lines
            (id, quotation_id, position, description_en, kind, amount_minor, discount_minor)
          VALUES ('q-bad-l${position}', 'q-bad', ${position}, 'Work', 'fixed', 1000, ${discountMinor})
        `);

      // The whole line given away is allowed; a fils more than the line is
      // not. Both halves are asserted so that a passing refusal cannot be a
      // mistake in the statement itself.
      await expect(insert(0, 1000)).resolves.toBeDefined();
      await expect(insert(1, 1001)).rejects.toThrow();
    });
  });

  it('survives a round trip with both kinds of line', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const quotation = drafted();
      quotation.addLine(
        line({
          id: 'q-l1',
          descriptionEn: 'VAT registration',
          descriptionAr: 'التسجيل الضريبي',
          pricing: { kind: 'hours', hours: 3.5, perHour: aed(12_345) },
        }),
      );
      quotation.addLine(
        line({
          id: 'q-l2',
          descriptionEn: 'Annual audit',
          descriptionAr: 'التدقيق السنوي',
          pricing: { kind: 'fixed', amount: aed(500_000) },
        }),
      );

      const repository = new DrizzleQuotationRepository(db);
      await repository.save(quotation);

      const back = await repository.findById('q-1');
      const state = back?.snapshot();

      expect(state?.reference).toBe('Q-2026-014');
      expect(state?.lines).toHaveLength(2);
      // The half hour survived as hundredths rather than as a float.
      expect(state?.lines[0]?.pricing).toMatchObject({ kind: 'hours', hours: 3.5 });
      expect(back?.total().minorUnits).toBe(543_208);
      expect(state?.validUntil?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    });
  });

  it('keeps the order the firm wrote the lines in', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const quotation = drafted();
      for (const [index, name] of ['third', 'first', 'second'].entries()) {
        quotation.addLine(
          line({
            id: `q-l${index}`,
            descriptionEn: name,
            descriptionAr: name,
            pricing: { kind: 'fixed', amount: aed(1000) },
          }),
        );
      }

      const repository = new DrizzleQuotationRepository(db);
      await repository.save(quotation);

      const back = await repository.findById('q-1');
      expect(back?.snapshot().lines.map((line) => line.descriptionEn)).toEqual([
        'third',
        'first',
        'second',
      ]);
    });
  });

  it('finds one by the reference a client reads out', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const quotation = drafted();
      quotation.addLine(
        line({
          id: 'q-l1',
          descriptionEn: 'Work',
          descriptionAr: 'عمل',
          pricing: { kind: 'fixed', amount: aed(1000) },
        }),
      );

      const repository = new DrizzleQuotationRepository(db);
      await repository.save(quotation);

      expect((await repository.findByReference('Q-2026-014'))?.id).toBe('q-1');
      expect(await repository.findByReference('Q-2026-999')).toBeNull();
    });
  });

  it('refuses two quotations answering to one reference', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleQuotationRepository(db);

      const first = drafted();
      first.addLine(
        line({
          id: 'q-l1',
          descriptionEn: 'Work',
          descriptionAr: 'عمل',
          pricing: { kind: 'fixed', amount: aed(1000) },
        }),
      );
      await repository.save(first);

      // Same reference, different quotation. A client saying "Q-2026-014" on
      // the phone has to mean one document.
      const second = drafted({ id: 'q-2' });
      await expect(repository.save(second)).rejects.toThrow();
    });
  });

  it('replaces the lines rather than accumulating them', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleQuotationRepository(db);

      const quotation = drafted();
      quotation.addLine(
        line({
          id: 'q-l1',
          descriptionEn: 'One',
          descriptionAr: 'واحد',
          pricing: { kind: 'fixed', amount: aed(1000) },
        }),
      );
      await repository.save(quotation);

      quotation.removeLine('q-l1');
      quotation.addLine(
        line({
          id: 'q-l2',
          descriptionEn: 'Two',
          descriptionAr: 'اثنان',
          pricing: { kind: 'fixed', amount: aed(2000) },
        }),
      );
      await repository.save(quotation);

      const back = await repository.findById('q-1');
      expect(back?.snapshot().lines.map((line) => line.id)).toEqual(['q-l2']);
    });
  });

  it('carries a state change through', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleQuotationRepository(db);

      const quotation = drafted();
      quotation.addLine(
        line({
          id: 'q-l1',
          descriptionEn: 'Work',
          descriptionAr: 'عمل',
          pricing: { kind: 'fixed', amount: aed(1000) },
        }),
      );
      quotation.send(NOW, 'by_hand');
      await repository.save(quotation);

      const sent = await repository.findById('q-1');
      expect(sent?.currentState).toBe('sent');

      sent?.accept(days(2));
      if (sent) await repository.save(sent);

      const accepted = await repository.findById('q-1');
      expect(accepted?.currentState).toBe('accepted');
      expect(accepted?.snapshot().decidedAt?.toISOString()).toBe(days(2).toISOString());
    });
  });

  it('finds the ones that have lapsed, and not the ones that have not', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const repository = new DrizzleQuotationRepository(db);

      for (const [id, reference, until] of [
        ['q-old', 'Q-OLD', days(10)],
        ['q-new', 'Q-NEW', days(60)],
      ] as const) {
        const quotation = drafted({ id, reference, validUntil: until });
        quotation.addLine(line({ id: `${id}-l` }));
        quotation.send(NOW, 'by_hand');
        await repository.save(quotation);
      }

      // One never sent, so never lapsed: it was abandoned, not ignored.
      const abandoned = drafted({ id: 'q-draft', reference: 'Q-DRAFT', validUntil: days(1) });
      abandoned.addLine(line({ id: 'q-draft-l' }));
      await repository.save(abandoned);

      const lapsed = await repository.lapsed(days(30), 10);
      expect(lapsed.map((quotation) => quotation.id)).toEqual(['q-old']);
    });
  });

  it('will not store a line with no words in either language', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // The domain refuses this too. The database refuses it again, because a
      // number the client cannot identify is a number they cannot check.
      await db.execute(`
        INSERT INTO quotations (id, client_id, reference, state, currency, created_by)
        VALUES ('q-9', 'q-c1', 'Q-9', 'draft', 'AED', 'q-u1')
      `);
      await expect(
        db.execute(`
          INSERT INTO quotation_lines (id, quotation_id, position, kind, amount_minor)
          VALUES ('q-9-l', 'q-9', 0, 'fixed', 1000)
        `),
      ).rejects.toThrow();
    });
  });

  it('will not store a line that is half hourly and half fixed', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await db.execute(`
        INSERT INTO quotations (id, client_id, reference, state, currency, created_by)
        VALUES ('q-10', 'q-c1', 'Q-10', 'draft', 'AED', 'q-u1')
      `);
      await expect(
        db.execute(`
          INSERT INTO quotation_lines
            (id, quotation_id, position, description_en, kind, hours_centi)
          VALUES ('q-10-l', 'q-10', 0, 'Work', 'hours', 350)
        `),
      ).rejects.toThrow();
    });
  });

  it('will not let a sent quotation claim it was never sent', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // Without a date it went out on, the follow-up list has nothing to count
      // days from.
      await expect(
        db.execute(`
          INSERT INTO quotations (id, client_id, reference, state, currency, created_by)
          VALUES ('q-11', 'q-c1', 'Q-11', 'sent', 'AED', 'q-u1')
        `),
      ).rejects.toThrow();
    });
  });
});
