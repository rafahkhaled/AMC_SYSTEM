import { MIGRATIONS_DIRECTORY, createDatabase, runMigrations } from '@amc/database';
import { PostgresJobQueue } from '@amc/queue';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertLog } from './alerts.js';
import { ESCALATION_JOB, fireEscalation, scheduleEscalations } from './escalations.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';
const NOW = new Date('2026-09-16T06:00:00Z');

class Ids {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `esc-${Date.now()}-${this.counter}`;
  }
}

describe('the escalation ladder against a real database', () => {
  let sql: postgres.Sql;
  let pool: ReturnType<typeof createDatabase>;
  let queue: PostgresJobQueue;

  beforeAll(async () => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);
    pool = createDatabase({ url: URL });
    queue = new PostgresJobQueue(pool.db, new Ids(), { now: () => NOW });
  });

  afterAll(async () => {
    await pool?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM jobs WHERE name = ${ESCALATION_JOB}`;
    await sql`DELETE FROM raised_alerts`;
    await sql`DELETE FROM tasks WHERE id LIKE 'esc-%'`;
    await sql`DELETE FROM client_services WHERE id LIKE 'esc-%'`;
    await sql`DELETE FROM clients WHERE id LIKE 'esc-%'`;
  });

  /** A task waiting on paperwork, asked for ten days ago, due in six weeks. */
  async function waitingTask(state = 'awaiting_documents', createdDaysAgo = 10) {
    const createdAt = new Date(NOW.getTime() - createdDaysAgo * 86_400_000);
    await sql`INSERT INTO clients (id, legal_name) VALUES ('esc-c1', 'Gulf Trading LLC')`;
    await sql`
      INSERT INTO client_services (id, client_id, service, active_from)
      VALUES ('esc-cs1', 'esc-c1', 'vat_return', '2026-01-01')
    `;
    await sql`
      INSERT INTO tasks (id, client_service_id, client_id, service, state, created_at, due_at)
      VALUES ('esc-t1', 'esc-cs1', 'esc-c1', 'vat_return', ${state}, ${createdAt},
              ${new Date(NOW.getTime() + 42 * 86_400_000)})
    `;
  }

  it('schedules each rung as a job with its own run-at time', async () => {
    await waitingTask();
    expect(await scheduleEscalations({ db: pool.db, queue, now: NOW })).toBeGreaterThan(0);

    const rows = await sql<{ unique_key: string; run_at: Date }[]>`
      SELECT unique_key, run_at FROM jobs WHERE name = ${ESCALATION_JOB} ORDER BY run_at
    `;
    // Nothing stays awake between them: a reminder due in six weeks costs
    // nothing until then.
    expect(rows.map((row) => row.unique_key.split(':').pop())).toEqual([
      'accountant_alert',
      'manager_alert',
    ]);
  });

  it('does not fire a rung whose moment has already passed', async () => {
    // Asked for ten days ago, so the seven-day reminder is behind us. Sending
    // it on day ten would be worse than silence.
    await waitingTask('awaiting_documents', 10);
    await scheduleEscalations({ db: pool.db, queue, now: NOW });

    const rows = await sql<{ unique_key: string }[]>`
      SELECT unique_key FROM jobs WHERE name = ${ESCALATION_JOB}
    `;
    expect(rows.some((row) => row.unique_key.endsWith('client_reminder'))).toBe(false);
  });

  it('schedules the same rung once however often the sweep runs', async () => {
    await waitingTask();
    await scheduleEscalations({ db: pool.db, queue, now: NOW });
    const second = await scheduleEscalations({ db: pool.db, queue, now: NOW });

    expect(second).toBe(0);
  });

  it('ignores work that is not waiting on anybody', async () => {
    await waitingTask('in_progress');
    expect(await scheduleEscalations({ db: pool.db, queue, now: NOW })).toBe(0);
  });

  it('raises the alert when the rung fires and the work is still stuck', async () => {
    await waitingTask();
    const alerts = new AlertLog(pool.db, new Ids());

    const outcome = await fireEscalation({
      db: pool.db,
      alerts,
      payload: { taskId: 'esc-t1', clientId: 'esc-c1', stage: 'accountant_alert' },
    });
    expect(outcome).toBe('raised');
  });

  it('says nothing when the documents arrived while the job was waiting', async () => {
    await waitingTask();
    const alerts = new AlertLog(pool.db, new Ids());

    // The job was queued weeks ago. Chasing a client for paperwork they have
    // already sent is the fastest way to teach them to ignore reminders.
    await sql`UPDATE tasks SET state = 'in_progress' WHERE id = 'esc-t1'`;

    expect(
      await fireEscalation({
        db: pool.db,
        alerts,
        payload: { taskId: 'esc-t1', clientId: 'esc-c1', stage: 'accountant_alert' },
      }),
    ).toBe('no_longer_needed');
  });

  it('says nothing about a task that has since been deleted', async () => {
    const alerts = new AlertLog(pool.db, new Ids());
    expect(
      await fireEscalation({
        db: pool.db,
        alerts,
        payload: { taskId: 'esc-gone', clientId: 'esc-c1', stage: 'manager_alert' },
      }),
    ).toBe('no_longer_needed');
  });

  it('does not repeat itself if the job is delivered twice', async () => {
    await waitingTask();
    const alerts = new AlertLog(pool.db, new Ids());
    const payload = { taskId: 'esc-t1', clientId: 'esc-c1', stage: 'manager_alert' } as const;

    expect(await fireEscalation({ db: pool.db, alerts, payload })).toBe('raised');
    // Delivery is at-least-once, so a handler that cannot tolerate a repeat
    // will eventually send one.
    expect(await fireEscalation({ db: pool.db, alerts, payload })).toBe('already_raised');
  });
});
