import { MIGRATIONS_DIRECTORY, createDatabase, runMigrations } from '@amc/database';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PermanentJobFailure, backoffSeconds } from './job.js';
import { PostgresJobQueue } from './queue.js';
import { JobRunner } from './runner.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';

class Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `job-${process.pid}-${Date.now()}-${this.counter}`;
  }
}

class MovableClock {
  constructor(private current = new Date()) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

describe('the job queue against a real database', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;
  let clock: MovableClock;
  let queue: PostgresJobQueue;
  const prefix = `test-${Date.now()}`;

  beforeAll(async () => {
    sql = postgres(URL, { max: 5, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
    clock = new MovableClock();
    queue = new PostgresJobQueue(pool.db, new Ids(), clock);
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  afterEach(async () => {
    await sql`DELETE FROM jobs WHERE name LIKE ${`${prefix}%`}`;
  });

  it('runs a job that was enqueued', async () => {
    await queue.enqueue({ name: `${prefix}.simple`, payload: { clientId: 'c-1' } });

    const claimed = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    const job = claimed.find((candidate) => candidate.name === `${prefix}.simple`);

    expect(job?.payload).toEqual({ clientId: 'c-1' });
    expect(job?.attempts).toBe(1);
  });

  it('does not hand out a job before its time', async () => {
    await queue.enqueue({
      name: `${prefix}.later`,
      runAt: new Date(clock.now().getTime() + 3600_000),
    });

    const early = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    expect(early.some((job) => job.name === `${prefix}.later`)).toBe(false);

    // This is how an escalation at seven days is expressed: nothing stays
    // awake in between, the row simply becomes eligible.
    clock.advanceSeconds(3601);
    const later = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    expect(later.some((job) => job.name === `${prefix}.later`)).toBe(true);
  });

  it('gives the same job to only one of two workers claiming at once', async () => {
    for (let index = 0; index < 20; index += 1) {
      await queue.enqueue({ name: `${prefix}.contended`, payload: { index } });
    }

    // Both claim simultaneously. SKIP LOCKED is what has to hold here.
    const [first, second] = await Promise.all([
      queue.claim({ worker: 'w1', limit: 20, leaseSeconds: 60 }),
      queue.claim({ worker: 'w2', limit: 20, leaseSeconds: 60 }),
    ]);

    const mine = first.filter((job) => job.name === `${prefix}.contended`).map((job) => job.id);
    const theirs = second.filter((job) => job.name === `${prefix}.contended`).map((job) => job.id);

    expect(mine.length + theirs.length).toBe(20);
    expect(new Set([...mine, ...theirs]).size).toBe(20);
  });

  it('will not hand a claimed job to anyone else while the lease holds', async () => {
    await queue.enqueue({ name: `${prefix}.leased` });
    await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });

    clock.advanceSeconds(30);
    const second = await queue.claim({ worker: 'w2', limit: 10, leaseSeconds: 60 });
    expect(second.some((job) => job.name === `${prefix}.leased`)).toBe(false);
  });

  it('hands back the work of a worker that died', async () => {
    await queue.enqueue({ name: `${prefix}.abandoned` });
    await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 30 });

    clock.advanceSeconds(31);
    const released = await queue.releaseExpiredClaims();
    expect(released).toBeGreaterThan(0);

    const retaken = await queue.claim({ worker: 'w2', limit: 10, leaseSeconds: 30 });
    expect(retaken.some((job) => job.name === `${prefix}.abandoned`)).toBe(true);
  });

  it('retries after a backoff, then stops and keeps the record', async () => {
    await queue.enqueue({ name: `${prefix}.flaky`, maxAttempts: 2 });

    const [first] = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    if (!first) throw new Error('expected a job');
    expect(await queue.fail(first, 'the supplier API was down')).toBe('retrying');

    clock.advanceSeconds(backoffSeconds(1) + 1);
    const [second] = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    if (!second) throw new Error('expected the retry');
    expect(second.attempts).toBe(2);
    expect(await queue.fail(second, 'still down')).toBe('failed');

    // Kept, not discarded: "what happened to that batch?" must have an answer.
    const [row] = await sql<{ failed_at: Date | null; last_error: string }[]>`
      SELECT failed_at, last_error FROM jobs WHERE id = ${second.id}
    `;
    expect(row?.failed_at).not.toBeNull();
    expect(row?.last_error).toBe('still down');
  });

  it('stops immediately on a failure that retrying cannot fix', async () => {
    await queue.enqueue({ name: `${prefix}.malformed`, maxAttempts: 10 });
    const [job] = await queue.claim({ worker: 'w1', limit: 10, leaseSeconds: 60 });
    if (!job) throw new Error('expected a job');

    expect(await queue.fail(job, 'payload has no clientId', true)).toBe('failed');
  });

  it('refuses a second live job for the same natural key', async () => {
    const key = `${prefix}:vat:client-1:2026Q3`;
    const first = await queue.enqueue({ name: `${prefix}.vat`, uniqueKey: key });
    const second = await queue.enqueue({ name: `${prefix}.vat`, uniqueKey: key });

    // This is what makes a scheduler safe to replay after an outage.
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('allows the key again once the work is done, so next quarter can run', async () => {
    const key = `${prefix}:vat:client-2:2026Q3`;
    const first = await queue.enqueue({ name: `${prefix}.vat`, uniqueKey: key });
    if (!first) throw new Error('expected an id');
    await queue.complete(first);

    expect(await queue.enqueue({ name: `${prefix}.vat`, uniqueKey: key })).not.toBeNull();
  });

  it('takes higher priority work first', async () => {
    await queue.enqueue({ name: `${prefix}.low`, priority: 0 });
    await queue.enqueue({ name: `${prefix}.high`, priority: 10 });

    const [first] = await queue.claim({ worker: 'w1', limit: 1, leaseSeconds: 60 });
    expect(first?.name).toBe(`${prefix}.high`);
  });

  it('enqueues inside the caller transaction, so a rollback takes the job with it', async () => {
    const name = `${prefix}.transactional`;

    await expect(
      pool.db.transaction(async (tx) => {
        await queue.enqueue({ name }, tx as never);
        throw new Error('the work failed after the job was queued');
      }),
    ).rejects.toThrow('the work failed');

    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM jobs WHERE name = ${name}
    `;
    // The whole point of ADR-0006: no job for a change that did not happen.
    expect(rows[0]?.count).toBe('0');
  });
});

describe('the runner', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;
  let queue: PostgresJobQueue;
  const prefix = `runner-${Date.now()}`;

  beforeAll(async () => {
    sql = postgres(URL, { max: 3, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
    queue = new PostgresJobQueue(pool.db, new Ids(), { now: () => new Date() });
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  afterEach(async () => {
    await sql`DELETE FROM jobs WHERE name LIKE ${`${prefix}%`}`;
  });

  function runner(): JobRunner {
    return new JobRunner(
      queue,
      { now: () => new Date() },
      {
        worker: 'test',
        batchSize: 50,
        leaseSeconds: 60,
        idleMilliseconds: 10,
      },
    );
  }

  it('runs a handler and marks the job done', async () => {
    const seen: string[] = [];
    const job = runner().register(`${prefix}.work`, async (received) => {
      seen.push(received.payload.who as string);
    });

    await queue.enqueue({ name: `${prefix}.work`, payload: { who: 'Wael' } });
    await job.runOnce();

    expect(seen).toEqual(['Wael']);
    const [row] = await sql<{ completed_at: Date | null }[]>`
      SELECT completed_at FROM jobs WHERE name = ${`${prefix}.work`}
    `;
    expect(row?.completed_at).not.toBeNull();
  });

  it('lets one failure pass without stopping the batch', async () => {
    const processed: number[] = [];
    const job = runner().register(`${prefix}.batch`, async (received) => {
      const index = received.payload.index as number;
      if (index === 3) throw new Error('this invoice is unreadable');
      processed.push(index);
    });

    for (let index = 0; index < 6; index += 1) {
      await queue.enqueue({ name: `${prefix}.batch`, payload: { index } });
    }
    await job.runOnce();

    // NFR-02: the unreadable one goes to exceptions, the rest carry on.
    expect(processed.sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5]);
  });

  it('stops a job whose name nothing handles, rather than looping for ever', async () => {
    await queue.enqueue({ name: `${prefix}.nobody-handles-this` });
    await runner().runOnce();

    const [row] = await sql<{ failed_at: Date | null; last_error: string }[]>`
      SELECT failed_at, last_error FROM jobs WHERE name = ${`${prefix}.nobody-handles-this`}
    `;
    expect(row?.failed_at).not.toBeNull();
    expect(row?.last_error).toContain('No handler registered');
  });

  it('does not retry a failure that says retrying will not help', async () => {
    const job = runner().register(`${prefix}.permanent`, async () => {
      throw new PermanentJobFailure('the payload has no client');
    });

    await queue.enqueue({ name: `${prefix}.permanent`, maxAttempts: 10 });
    await job.runOnce();

    const [row] = await sql<{ failed_at: Date | null; attempts: number }[]>`
      SELECT failed_at, attempts FROM jobs WHERE name = ${`${prefix}.permanent`}
    `;
    expect(row?.failed_at).not.toBeNull();
    expect(row?.attempts).toBe(1);
  });

  it('starts and stops cleanly, finishing what it began', async () => {
    let handled = 0;
    const job = runner().register(`${prefix}.loop`, async () => {
      handled += 1;
    });

    await queue.enqueue({ name: `${prefix}.loop` });
    const loop = job.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await job.stop();
    await loop;

    expect(handled).toBe(1);
  });
});

describe('backoff', () => {
  it('starts short, grows quickly, and then stops growing', () => {
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(3)).toBe(8);
    expect(backoffSeconds(6)).toBe(64);
    // Capped, so a job never drifts hours into the future unnoticed.
    expect(backoffSeconds(20)).toBe(300);
  });
});
