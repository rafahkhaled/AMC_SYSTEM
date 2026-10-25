import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Branch, salesperson and who did the work, from the enquiry to the invoice.
 *
 * Each value is chosen once and carried forward, and can be changed on any
 * step. The tests walk one client through the whole way and check what each
 * step started with.
 */
describe('branch, salesperson and who did the work', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;
  let agent: string;
  let employeeSalesperson: string;

  const get = (entity: string, id: string) =>
    manager.get(`/classification/${entity}/${id}`).expect(200);
  const set = (entity: string, id: string, body: Record<string, unknown>) =>
    manager.patch(`/classification/${entity}/${id}`).send(body);

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
  });
  afterAll(async () => {
    await t.close();
  });

  describe('the salespeople', () => {
    it('lists every employee without anybody adding them', async () => {
      const list = await accountant.get('/salespeople').expect(200);
      const userIds = list.body.salespeople.map((s: { userId: string | null }) => s.userId);
      expect(userIds).toEqual(expect.arrayContaining([manager.userId, accountant.userId]));
      employeeSalesperson = list.body.salespeople.find(
        (s: { userId: string | null }) => s.userId === accountant.userId,
      ).id;
    });

    it('adds somebody from outside by name, once', async () => {
      const added = await manager.post('/salespeople').send({ name: 'Omar the agent' }).expect(201);
      agent = added.body.id;
      const again = await manager.post('/salespeople').send({ name: 'omar THE agent' }).expect(201);
      expect(again.body.id).toBe(agent);
      expect(added.body.salespeople.map((s: { name: string }) => s.name)).toContain(
        'Omar the agent',
      );
      await manager.post('/salespeople').send({ name: '' }).expect(400);
      await dataEntry.post('/salespeople').send({ name: 'Me' }).expect(403);
    });

    it('a new employee becomes a salesperson by themselves', async () => {
      const fresh = await t.another('accountant', 'newcomer');
      const list = await manager.get('/salespeople').expect(200);
      expect(list.body.salespeople.map((s: { userId: string | null }) => s.userId)).toContain(
        fresh.userId,
      );
    });

    it('retires an outside salesperson, and keeps them on the list as retired', async () => {
      const extra = (
        await manager.post('/salespeople').send({ name: 'Short contract' }).expect(201)
      ).body.id;
      const after = await manager
        .patch(`/salespeople/${extra}`)
        .send({ retired: true })
        .expect(200);
      expect(after.body.salespeople.find((s: { id: string }) => s.id === extra).retired).toBe(true);
      await accountant.patch(`/salespeople/${extra}`).send({ retired: false }).expect(403);
    });
  });

  describe('from the enquiry to the invoice', () => {
    let leadId: string;
    let clientId: string;

    it('sets them on the enquiry', async () => {
      const board = await manager
        .post('/leads')
        .send({ name: 'Forma7 Concepts', phone: '+971501234567', source: 'referral' })
        .expect(201);
      leadId = board.body.columns
        .flatMap((c: { leads: { id: string; name: string }[] }) => c.leads)
        .find((l: { name: string }) => l.name === 'Forma7 Concepts').id;
      const set1 = await set('lead', leadId, { branchCode: 'ajman', salespersonId: agent }).expect(
        200,
      );
      expect(set1.body).toMatchObject({
        branchCode: 'ajman',
        salespersonId: agent,
        performerEditable: false,
      });
    });

    it('hands them to the client the enquiry becomes', async () => {
      await manager.post(`/leads/${leadId}/move`).send({ to: 'contacted' }).expect(201);
      clientId = (
        await manager
          .post(`/leads/${leadId}/quote`)
          .send({ legalName: 'Forma7 Concepts LLC' })
          .expect(201)
      ).body.clientId;
      const onClient = await get('client', clientId);
      expect(onClient.body).toMatchObject({ branchCode: 'ajman', salespersonId: agent });

      // Who does the work is chosen on the client.
      await set('client', clientId, { performedBy: accountant.userId }).expect(200);
    });

    it('starts a quotation with the client’s salesperson and performer', async () => {
      const quotation = (
        await manager
          .post('/billing/quotations')
          .send({ clientId, branchCode: 'ajman' })
          .expect(201)
      ).body.id;
      const onQuote = await get('quotation', quotation);
      expect(onQuote.body).toMatchObject({
        salespersonId: agent,
        performedBy: accountant.userId,
        branchEditable: false,
      });

      // Changed on the quotation, and only there.
      await set('quotation', quotation, { salespersonId: employeeSalesperson }).expect(200);
      expect((await get('quotation', quotation)).body.salespersonId).toBe(employeeSalesperson);
      expect((await get('client', clientId)).body.salespersonId).toBe(agent);
    });

    it('starts a job with the client’s branch and salesperson, and the performer responsible', async () => {
      const job = (
        await manager.post('/projects').send({ clientId, service: 'emaratax_request' }).expect(201)
      ).body.id;
      const onJob = await get('project', job);
      expect(onJob.body).toMatchObject({
        branchCode: 'ajman',
        salespersonId: agent,
        performedBy: accountant.userId,
        performerEditable: false,
      });
      const detail = await manager.get(`/projects/${job}`).expect(200);
      expect(detail.body.assignees).toEqual([
        expect.objectContaining({ userId: accountant.userId, role: 'responsible' }),
      ]);
      // The job's own branch can be changed.
      await set('project', job, { branchCode: 'dubai' }).expect(200);
      expect((await get('project', job)).body.branchCode).toBe('dubai');
    });

    it('starts an invoice with them too', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId, service: 'tax_profile_update' })
          .expect(201)
      ).body.id;
      await manager
        .post('/timer/entries')
        .send({
          projectId: job,
          startedAt: '2026-09-03T09:00',
          endedAt: '2026-09-03T11:00',
          reason: 'Call with the client',
        })
        .expect(201);
      const queue = await manager.get('/timer/approvals').expect(200);
      await manager
        .post('/timer/entries/approve')
        .send({ entryIds: queue.body.entries.map((e: { id: string }) => e.id) })
        .expect(201);
      const statement = (
        await manager
          .post('/billing/statements')
          .send({ clientId, from: '2026-09-01', to: '2026-09-30' })
          .expect(201)
      ).body.id;
      await manager.post(`/billing/statements/${statement}/approve`).expect(201);
      const invoice = (
        await manager
          .post(`/billing/statements/${statement}/invoice`)
          .send({ branchCode: 'ajman' })
          .expect(201)
      ).body.id;

      const onInvoice = await get('invoice', invoice);
      expect(onInvoice.body).toMatchObject({
        branchCode: 'ajman',
        salespersonId: agent,
        performedBy: accountant.userId,
        branchEditable: false,
      });
      // The branch printed on an issued invoice is fixed.
      await set('invoice', invoice, { branchCode: 'dubai' }).expect(409);
    });
  });

  describe('changing them', () => {
    let clientId: string;

    beforeAll(async () => {
      clientId = (await manager.post('/clients').send({ legalName: 'Noor Medical' }).expect(201))
        .body.id;
    });

    it('refuses a branch, salesperson or person that is not real', async () => {
      await set('client', clientId, { branchCode: 'paris' }).expect(409);
      await set('client', clientId, { salespersonId: 'nobody' }).expect(409);
      await set('client', clientId, { performedBy: 'nobody' }).expect(409);
      await set('nothing', clientId, {}).expect(404);
      await set('client', 'missing', { branchCode: 'dubai' }).expect(404);
    });

    it('clears a value sent as null', async () => {
      await set('client', clientId, { branchCode: 'dubai' }).expect(200);
      const cleared = await set('client', clientId, { branchCode: null }).expect(200);
      expect(cleared.body.branchCode).toBeNull();
    });

    it('is for people who may edit that kind of record, on clients they can reach', async () => {
      await dataEntry
        .patch(`/classification/client/${clientId}`)
        .send({ branchCode: 'dubai' })
        .expect(404);
      await accountant.get(`/classification/client/${clientId}`).expect(404);
      await t.anonymous().get(`/classification/client/${clientId}`).expect(401);
    });

    it('writes each change to the audit log', async () => {
      const rows = await t.sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE action LIKE 'classification.%'
      `;
      const actions = new Set(rows.map((row) => row.action));
      for (const action of [
        'classification.lead.changed',
        'classification.client.changed',
        'classification.quotation.changed',
        'classification.project.changed',
        'classification.salesperson.added',
      ]) {
        expect(actions).toContain(action);
      }
    });
  });

  describe('the report', () => {
    it('adds the period up by branch, by salesperson and by who did the work', async () => {
      const report = await manager
        .get('/classification/report?from=2026-01-01&to=2030-12-31')
        .expect(200);
      const ajman = report.body.byBranch.find((row: { key: string | null }) => row.key === 'ajman');
      expect(ajman).toMatchObject({ invoices: 1, invoicedMinor: 60_000 });
      const omar = report.body.bySalesperson.find(
        (row: { key: string | null }) => row.key === agent,
      );
      expect(omar).toMatchObject({ name: 'Omar the agent', invoices: 1 });
      const performer = report.body.byPerformer.find(
        (row: { key: string | null }) => row.key === accountant.userId,
      );
      expect(performer.invoicedMinor).toBe(60_000);
    });

    it('needs a sensible period, and billing access', async () => {
      await manager.get('/classification/report?from=2026-12-01&to=2026-01-01').expect(400);
      await manager.get('/classification/report').expect(400);
      await dataEntry.get('/classification/report?from=2026-01-01&to=2026-12-31').expect(403);
    });
  });
});
