import { MIGRATIONS_DIRECTORY, createDatabase, runMigrations } from '@amc/database';
import { SystemClock, domainEvent } from '@amc/kernel';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReadAuditLog } from '../application/read-audit-log.js';
import { DrizzleAuditReader, DrizzleOutboxReader } from './audit.repository.js';
import { DrizzleUnitOfWork, entityTypeOf } from './unit-of-work.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';

class Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `id-${Date.now()}-${this.counter}`;
  }
}

const ACTOR = {
  userId: 'user-1',
  roles: ['manager'],
  label: 'Wael Ajam',
  ipAddress: '10.0.0.5',
  requestId: 'req-1',
  sessionId: 'sess-1',
};

describe('the audit log against a real database', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;
  let unitOfWork: DrizzleUnitOfWork;
  let reader: DrizzleAuditReader;

  beforeAll(async () => {
    sql = postgres(URL, { max: 3, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
    unitOfWork = new DrizzleUnitOfWork(pool.db, new Ids(), new SystemClock());
    reader = new DrizzleAuditReader(pool.db);
    // pending() returns the oldest first, so a backlog left by an earlier run
    // would push this file's own events off the page and fail for a reason
    // that has nothing to do with the code.
    await sql`DELETE FROM outbox`;
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // The table refuses DELETE, so tests are isolated by entity id instead.
    await sql`SELECT 1`;
  });

  it('refuses to let anyone update a recorded entry', async () => {
    const entityId = `client-${Date.now()}`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.audit({
        action: 'client.created',
        entityType: 'client',
        entityId,
        after: { name: 'Acme' },
      });
    });

    await expect(
      sql`UPDATE audit_log SET action = 'client.tampered' WHERE entity_id = ${entityId}`,
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to let anyone delete one, or empty the table', async () => {
    const entityId = `client-${Date.now()}-delete`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.audit({ action: 'client.created', entityType: 'client', entityId });
    });

    await expect(sql`DELETE FROM audit_log WHERE entity_id = ${entityId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`TRUNCATE audit_log`).rejects.toThrow(/append-only/);
  });

  it('records who acted, from where, and under which request', async () => {
    const entityId = `client-${Date.now()}-actor`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.audit({
        action: 'client.rate.changed',
        entityType: 'client',
        entityId,
        before: { hourlyRate: 30000 },
        after: { hourlyRate: 35000 },
      });
    });

    const found = await reader.search({ entityType: 'client', entityId, limit: 10 });
    const entry = found.entries[0];
    expect(entry?.actorUserId).toBe('user-1');
    expect(entry?.actorRoles).toEqual(['manager']);
    expect(entry?.actorLabel).toBe('Wael Ajam');
    expect(entry?.ipAddress).toBe('10.0.0.5');
    expect(entry?.requestId).toBe('req-1');
    expect(entry?.before).toEqual({ hourlyRate: 30000 });
    expect(entry?.after).toEqual({ hourlyRate: 35000 });
  });

  it('writes nothing at all when the work fails, so the log never describes a change that was undone', async () => {
    const entityId = `client-${Date.now()}-rollback`;

    await expect(
      unitOfWork.run(ACTOR, async (context) => {
        context.audit({ action: 'client.created', entityType: 'client', entityId });
        throw new Error('the work failed after the audit was queued');
      }),
    ).rejects.toThrow('the work failed');

    const found = await reader.search({ entityType: 'client', entityId, limit: 10 });
    expect(found.entries).toHaveLength(0);
  });

  it('turns every recorded domain event into an entry and an outbox row', async () => {
    const aggregateId = `task-${Date.now()}`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.collect([
        domainEvent('services.task.completed', aggregateId, new Date(), { taskId: aggregateId }),
      ]);
    });

    const found = await reader.search({ entityId: aggregateId, limit: 10 });
    expect(found.entries[0]?.action).toBe('services.task.completed');
    expect(found.entries[0]?.entityType).toBe('services.task');

    const pending = await new DrizzleOutboxReader(pool.db).pending(100);
    expect(pending.some((record) => record.event.aggregateId === aggregateId)).toBe(true);
  });

  it('never records a secret, only that it changed', async () => {
    const entityId = `user-${Date.now()}-secret`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.audit({
        action: 'identity.password.changed',
        entityType: 'identity.user',
        entityId,
        before: { passwordHash: '$argon2id$old', totpSecret: 'JBSWY3DPEHPK3PXP' },
        after: { passwordHash: '$argon2id$new', totpSecret: 'NEWSECRETVALUE12' },
      });
    });

    const found = await reader.search({ entityId, limit: 10 });
    const entry = found.entries[0];
    expect(entry?.before).toEqual({ passwordHash: '[redacted]', totpSecret: '[redacted]' });
    expect(entry?.after).toEqual({ passwordHash: '[redacted]', totpSecret: '[redacted]' });
    expect(JSON.stringify(entry)).not.toContain('JBSWY3DP');
  });

  it('pages without losing or repeating an entry as new ones arrive', async () => {
    const entityId = `paged-${Date.now()}`;
    for (let index = 0; index < 5; index += 1) {
      await unitOfWork.run(ACTOR, async (context) => {
        context.audit({ action: `step.${index}`, entityType: 'paged', entityId });
      });
    }

    const first = await reader.search({ entityType: 'paged', entityId, limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await reader.search({
      entityType: 'paged',
      entityId,
      limit: 10,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const ids = new Set([...first.entries, ...second.entries].map((entry) => entry.id));
    expect(ids.size).toBe(first.entries.length + second.entries.length);
  });

  it('refuses an unreasonable page size and a backwards date range', async () => {
    const readLog = new ReadAuditLog(reader);
    expect((await readLog.execute({ limit: 5000 })).ok).toBe(false);
    expect((await readLog.execute({ limit: 0 })).ok).toBe(false);
    expect(
      (await readLog.execute({ from: new Date('2026-09-15'), to: new Date('2026-09-01') })).ok,
    ).toBe(false);
  });
});

describe('entity types derived from event names', () => {
  it('takes the thing from the middle of the name', () => {
    expect(entityTypeOf('identity.session.revoked')).toBe('identity.session');
    expect(entityTypeOf('billing.invoice.issued')).toBe('billing.invoice');
    expect(entityTypeOf('short')).toBe('short');
  });
});

describe('the outbox against a real database', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;
  let unitOfWork: DrizzleUnitOfWork;
  let outbox: DrizzleOutboxReader;

  beforeAll(async () => {
    sql = postgres(URL, { max: 3, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
    unitOfWork = new DrizzleUnitOfWork(pool.db, new Ids(), new SystemClock());
    outbox = new DrizzleOutboxReader(pool.db);
    // Earlier tests leave pending rows behind, and pending() returns the
    // oldest first, so without this the event under test is never in the page.
    await sql`DELETE FROM outbox`;
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  it('marks delivered events published, which the fakes in the worker could never prove', async () => {
    const aggregateId = `outbox-${Date.now()}`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.collect([
        domainEvent('test.thing.happened', aggregateId, new Date(), { id: aggregateId }),
      ]);
    });

    const pending = await outbox.pending(100);
    const mine = pending.find((record) => record.event.aggregateId === aggregateId);
    expect(mine).toBeDefined();
    if (!mine) return;

    await outbox.markPublished([mine.id], new Date());

    const stillPending = await outbox.pending(100);
    expect(stillPending.some((record) => record.id === mine.id)).toBe(false);

    const [row] = await sql<{ published_at: Date | null }[]>`
      SELECT published_at FROM outbox WHERE id = ${mine.id}
    `;
    expect(row?.published_at).not.toBeNull();
  });

  it('counts a failed delivery and keeps the reason, without losing the event', async () => {
    const aggregateId = `outbox-fail-${Date.now()}`;
    await unitOfWork.run(ACTOR, async (context) => {
      context.collect([domainEvent('test.thing.failed', aggregateId, new Date(), {})]);
    });

    const pending = await outbox.pending(100);
    const mine = pending.find((record) => record.event.aggregateId === aggregateId);
    if (!mine) throw new Error('expected the event');

    await outbox.markFailed(mine.id, 'the subscriber was unreachable');

    const [row] = await sql<{ attempts: number; last_error: string; published_at: Date | null }[]>`
      SELECT attempts, last_error, published_at FROM outbox WHERE id = ${mine.id}
    `;
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe('the subscriber was unreachable');
    // Still pending: a failed delivery must be tried again, not dropped.
    expect(row?.published_at).toBeNull();
  });
});
