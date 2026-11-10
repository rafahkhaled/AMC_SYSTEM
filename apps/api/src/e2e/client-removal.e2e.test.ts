import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Deleting a client (feedback: "how do we delete a client").
 *
 * Driven through the API with real rows in every table that holds on to a
 * client, because the failure that matters is a foreign key nobody thought of.
 */
describe('deleting a client', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
  });
  afterAll(async () => {
    await t.close();
  });

  it('deletes a client with jobs, time, a quotation and files, and all of it with them', async () => {
    await t.client('c-gone', 'Mistake Trading LLC', { assignTo: [accountant] });
    const job = (
      await manager
        .post('/projects')
        .send({ clientId: 'c-gone', service: 'emaratax_request' })
        .expect(201)
    ).body.id;
    await manager
      .post('/timer/entries')
      .send({
        projectId: job,
        startedAt: '2026-09-03T09:00',
        endedAt: '2026-09-03T10:00',
        reason: 'Call with the client',
      })
      .expect(201);
    await manager.post('/billing/quotations').send({ clientId: 'c-gone' }).expect(201);
    await manager
      .post('/clients/c-gone/folders')
      .send({ name: 'Old' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await manager
      .post('/clients/c-gone/files')
      .attach('files', Buffer.from('notes'), 'notes.txt')
      .expect(201);

    await accountant.delete('/clients/c-gone').expect(403);
    await manager.delete('/clients/c-gone').expect(200);

    await manager.get('/clients/c-gone').expect(404);
    const [left] = await t.sql<{ projects: number; quotations: number; files: number }[]>`
      SELECT (SELECT count(*) FROM projects WHERE client_id = 'c-gone')::int AS projects,
             (SELECT count(*) FROM quotations WHERE client_id = 'c-gone')::int AS quotations,
             (SELECT count(*) FROM client_files WHERE client_id = 'c-gone')::int AS files
    `;
    expect(left).toEqual({ projects: 0, quotations: 0, files: 0 });

    const [audit] = await t.sql<{ actor_user_id: string }[]>`
      SELECT actor_user_id FROM audit_log WHERE action = 'clients.client.deleted' AND entity_id = 'c-gone'`;
    expect(audit?.actor_user_id).toBe(manager.userId);
  });

  it('keeps a client who has been sent a statement, and says to close it instead', async () => {
    await t.client('c-billed', 'Billed Trading LLC');
    await t.sql`
      INSERT INTO statements (id, client_id, period_start, period_end, created_by)
      VALUES ('s-billed', 'c-billed', '2026-09-01', '2026-09-30', ${manager.userId})`;

    const refused = await manager.delete('/clients/c-billed').expect(409);
    expect(refused.body.error.message).toContain('mark it closed instead');
    await manager.get('/clients/c-billed').expect(200);
  });

  it('says so for a client that does not exist', async () => {
    await manager.delete('/clients/nobody').expect(404);
  });
});
