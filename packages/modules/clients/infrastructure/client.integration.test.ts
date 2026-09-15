import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import { Money, Rate } from '@amc/kernel';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, FinancialYear, Trn, VatPeriods } from '../domain/index.js';
import { DrizzleClientRepository } from './client.repository.js';

const at = (iso: string) => new Date(iso);
const rate = (major: string) => Rate.perHour(Money.ofMajor(major, 'AED'));
const FIRM_DEFAULT = rate('250.00');

function trn(value: string) {
  const parsed = Trn.of(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

describe('clients against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  function repository(tx: unknown) {
    return new DrizzleClientRepository(tx as ReturnType<typeof drizzle>);
  }

  function newClient(id: string, name = 'Gulf Trading LLC') {
    const created = Client.onboard({ id, legalName: name, now: at('2026-01-10T06:00:00Z') });
    if (!created.ok) throw new Error('fixture');
    return created.value;
  }

  it('saves a client and reads it back whole', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-1');
      const periods = VatPeriods.of('quarterly', 1);
      const year = FinancialYear.endingIn(6);
      if (!periods.ok || !year.ok) throw new Error('fixture');

      client.registerForVat({
        trn: trn('100123456700003'),
        registeredOn: at('2026-02-01T00:00:00Z'),
        periods: periods.value,
        now: at('2026-02-01T06:00:00Z'),
      });
      client.registerForCorporateTax({
        trn: trn('100999888700003'),
        registeredOn: at('2026-02-01T00:00:00Z'),
        financialYear: year.value,
        now: at('2026-02-01T06:00:00Z'),
      });
      await clients.save(client);

      const found = await clients.findById('c-1');
      expect(found?.legalName).toBe('Gulf Trading LLC');
      expect(found?.vat.trn?.value).toBe('100123456700003');
      // The staggered cycle has to survive the round trip, or the deadline
      // engine computes the wrong dates for everyone not on calendar quarters.
      expect(found?.vatPeriods?.endMonths()).toEqual([1, 4, 7, 10]);
      expect(found?.financialYear?.endMonth).toBe(6);
    });
  });

  it('refuses two clients sharing one tax registration number', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const periods = VatPeriods.of('quarterly', 3);
      if (!periods.ok) throw new Error('fixture');

      for (const id of ['c-1', 'c-2']) {
        const client = newClient(id, `Client ${id}`);
        client.registerForVat({
          trn: trn('100123456700003'),
          registeredOn: at('2026-02-01T00:00:00Z'),
          periods: periods.value,
          now: at('2026-02-01T06:00:00Z'),
        });
        if (id === 'c-1') await clients.save(client);
        else await expect(clients.save(client)).rejects.toThrow();
      }
    });
  });

  it('will not store a registration without the cycle that makes a deadline', async () => {
    await database.inRollbackTransaction(async (tx) => {
      // Straight to SQL, to prove the database refuses it however it arrives.
      await expect(
        tx.execute(
          `INSERT INTO clients (id, legal_name, vat_state, vat_trn)
           VALUES ('c-bad', 'No Cycle LLC', 'registered', '100123456700003')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('refuses a tax registration number of the wrong shape', async () => {
    await database.inRollbackTransaction(async (tx) => {
      await expect(
        tx.execute(
          `INSERT INTO clients (id, legal_name, vat_trn) VALUES ('c-bad', 'Short TRN LLC', '123')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('keeps every rate change, and answers with the one that applied', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-3');

      client.changeRate(
        { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
        at('2026-01-01T06:00:00Z'),
      );
      client.changeRate(
        {
          rate: rate('350.00'),
          effectiveFrom: at('2026-04-01T00:00:00Z'),
          changedBy: 'user-1',
          note: 'agreed in the March review',
        },
        at('2026-03-20T06:00:00Z'),
      );
      await clients.save(client);

      const found = await clients.findById('c-3');
      expect(found?.rates.all).toHaveLength(2);
      // March work keeps March's rate after the April rise, which is what makes
      // a reprinted statement match the one the client already paid.
      expect(found?.rateOn(at('2026-03-15T00:00:00Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
        '300.00',
      );
      expect(found?.rateOn(at('2026-04-15T00:00:00Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
        '350.00',
      );
      expect(found?.rates.all[1]?.note).toBe('agreed in the March review');
    });
  });

  it('stores the rate in whole fils, with no floating point in sight', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-4');
      client.changeRate(
        { rate: rate('333.33'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
        at('2026-01-01T06:00:00Z'),
      );
      await clients.save(client);

      const [row] = await tx.execute(
        "SELECT per_hour_minor FROM client_rates WHERE client_id = 'c-4'",
      );
      expect(Number((row as { per_hour_minor: string }).per_hour_minor)).toBe(33_333);
    });
  });

  it('refuses two rates taking effect on the same day, at the database too', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-5');
      client.changeRate(
        { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
        at('2026-01-01T06:00:00Z'),
      );
      await clients.save(client);

      await expect(
        tx.execute(
          `INSERT INTO client_rates (id, client_id, per_hour_minor, effective_from, changed_by)
           VALUES ('r-x', 'c-5', 40000, '2026-01-01', 'user-1')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('saves a client twice without duplicating the rate history', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-6');
      client.changeRate(
        { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
        at('2026-01-01T06:00:00Z'),
      );

      await clients.save(client);
      await clients.save(client);

      const found = await clients.findById('c-6');
      expect(found?.rates.all).toHaveLength(1);
    });
  });

  it('finds a client by the number the authority issued', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const clients = repository(tx);
      const client = newClient('c-7');
      const periods = VatPeriods.of('quarterly', 2);
      if (!periods.ok) throw new Error('fixture');

      client.registerForVat({
        trn: trn('100777666500003'),
        registeredOn: at('2026-02-01T00:00:00Z'),
        periods: periods.value,
        now: at('2026-02-01T06:00:00Z'),
      });
      await clients.save(client);

      const found = await clients.findByVatTrn(trn('100 777 666 500 003'));
      expect(found?.id).toBe('c-7');
    });
  });
});
