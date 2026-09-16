import { MIGRATIONS_DIRECTORY, createDatabase, runMigrations } from '@amc/database';
import { PostgresJobQueue } from '@amc/queue';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertLog } from './alerts.js';
import { nextDailyRun, runDailySweep } from './daily.js';
import { sweepDocumentExpiry } from './document-expiry.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';
const at = (iso: string) => new Date(`${iso}T06:00:00Z`);
const TODAY = at('2026-09-16');

class Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `sweep-${Date.now()}-${this.counter}`;
  }
}

describe('the daily sweep against a real database', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM raised_alerts`;
    await sql`DELETE FROM client_documents`;
    await sql`DELETE FROM clients WHERE id LIKE 'sweep-%'`;
    await sql`DELETE FROM jobs WHERE name = 'schedule.daily'`;
  });

  /** A licence expiring exactly ninety days from today. */
  async function licenceExpiringIn(days: number, id = 'doc-1') {
    const expiresOn = new Date(TODAY.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    await sql`
      INSERT INTO clients (id, legal_name) VALUES ('sweep-c1', 'Gulf Trading LLC')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO client_documents (id, client_id, type, status, storage_key, checksum, expires_on)
      VALUES (${id}, 'sweep-c1', 'trade_licence', 'held', 'k', 'c', ${expiresOn})
    `;
  }

  it('warns once at ninety days', async () => {
    await licenceExpiringIn(90);
    const alerts = new AlertLog(pool.db, new Ids());

    const raised = await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.daysRemaining).toBe(90);
    expect(raised[0]?.clientName).toBe('Gulf Trading LLC');
  });

  it('does not warn again the next day, or the day after', async () => {
    await licenceExpiringIn(90);
    const alerts = new AlertLog(pool.db, new Ids());

    await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY });

    // This is the whole point of the alert log. Asking "expiring within ninety
    // days" would raise this every day for three months, and a client who
    // receives ninety reminders has learned to ignore all of them.
    for (let day = 1; day <= 3; day += 1) {
      const later = new Date(TODAY.getTime() + day * 86_400_000);
      expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: later })).toHaveLength(0);
    }
  });

  it('warns again at sixty and at thirty, which are different rungs', async () => {
    await licenceExpiringIn(90);
    const alerts = new AlertLog(pool.db, new Ids());
    await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY });

    const at60 = new Date(TODAY.getTime() + 30 * 86_400_000);
    const at30 = new Date(TODAY.getTime() + 60 * 86_400_000);

    expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: at60 })).toHaveLength(1);
    expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: at30 })).toHaveLength(1);
  });

  it('catches up on a day it did not run', async () => {
    // Expires in 88 days, so its ninety-day mark fell two days ago and a
    // sweep that ran only today would miss it entirely.
    await licenceExpiringIn(88);
    const alerts = new AlertLog(pool.db, new Ids());

    // A worker down for a couple of days still sends the reminder rather than
    // skipping that rung for ever.
    const raised = await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY });
    expect(raised).toHaveLength(1);
  });

  it('is safe to run twice in one morning', async () => {
    await licenceExpiringIn(90);
    const alerts = new AlertLog(pool.db, new Ids());

    expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY })).toHaveLength(1);
    expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY })).toHaveLength(0);
  });

  it('says nothing about a document nowhere near expiry', async () => {
    await licenceExpiringIn(200);
    const alerts = new AlertLog(pool.db, new Ids());
    expect(await sweepDocumentExpiry({ db: pool.db, alerts, today: TODAY })).toHaveLength(0);
  });

  it('puts tomorrow sweep on the queue when it finishes', async () => {
    const queue = new PostgresJobQueue(pool.db, new Ids(), { now: () => TODAY });
    await runDailySweep({ db: pool.db, queue, clock: { now: () => TODAY }, ids: new Ids() });

    const [row] = await sql<{ run_at: Date; unique_key: string }[]>`
      SELECT run_at, unique_key FROM jobs WHERE name = 'schedule.daily'
    `;
    // Re-enqueuing itself keeps the schedule in the same place as the work,
    // so a restarted worker resumes rather than waiting for an external timer
    // nobody remembered to configure.
    expect(row?.unique_key).toBe('schedule.daily:2026-09-17');
  });

  it('enqueues one sweep however many workers finish at once', async () => {
    const queue = new PostgresJobQueue(pool.db, new Ids(), { now: () => TODAY });
    const context = { db: pool.db, queue, clock: { now: () => TODAY }, ids: new Ids() };

    await Promise.all([runDailySweep(context), runDailySweep(context), runDailySweep(context)]);

    const [row] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM jobs WHERE name = 'schedule.daily'
    `;
    expect(row?.count).toBe('1');
  });
});

describe('when the sweep runs', () => {
  it('is early morning in Dubai', () => {
    // Six in Dubai is two in UTC.
    expect(nextDailyRun(at('2026-09-16')).toISOString()).toBe('2026-09-17T02:00:00.000Z');
  });

  it('is today when today has not reached it yet', () => {
    const beforeDawn = new Date('2026-09-16T00:30:00Z');
    expect(nextDailyRun(beforeDawn).toISOString()).toBe('2026-09-16T02:00:00.000Z');
  });
});
