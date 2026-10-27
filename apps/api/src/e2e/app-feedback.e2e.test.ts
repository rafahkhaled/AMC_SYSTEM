import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The firm's "App" feedback, end to end: adding a client directly, a quotation
 * that takes several lines and emails the client's own address, a branch's
 * logo, putting people on a job and deleting one nobody worked on, and a
 * shorter Saturday.
 */
describe('the App feedback', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
  });
  afterAll(async () => {
    await t.close();
  });

  describe('adding a client directly', () => {
    it('adds one with only a name, and it opens at once', async () => {
      const created = await manager
        .post('/clients')
        .send({
          legalName: 'Forma7 Concepts LLC',
          legalNameArabic: 'فورما ٧',
          tradeLicenceNumber: 'CN-77',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        legalName: 'Forma7 Concepts LLC',
        legalNameArabic: 'فورما ٧',
        tradeLicenceNumber: 'CN-77',
        status: 'active',
      });
      await manager.get(`/clients/${created.body.id}`).expect(200);

      const [row] = await t.sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE entity_id = ${created.body.id} AND action = 'clients.client.onboarded'
      `;
      expect(row).toBeDefined();
    });

    it('refuses a client with no name, and somebody who may not edit clients', async () => {
      await manager.post('/clients').send({ legalName: '  ' }).expect(400);
      await accountant.post('/clients').send({ legalName: 'Mine LLC' }).expect(403);
      await dataEntry.post('/clients').send({ legalName: 'Mine LLC' }).expect(403);
    });

    it('lets somebody who sees only their own clients see the one they added', async () => {
      const roles = await manager.get('/roles').expect(200);
      const current: string[] =
        roles.body.roles.find((role: { role: string }) => role.role === 'accountant')
          ?.permissions ?? [];
      await manager
        .put('/roles/accountant/permissions')
        .send({ permissions: [...current, 'clients.edit'] })
        .expect(200);

      const created = await accountant
        .post('/clients')
        .send({ legalName: 'Added By Accountant LLC' })
        .expect(201);
      await accountant.get(`/clients/${created.body.id}`).expect(200);

      await manager.put('/roles/accountant/permissions').send({ permissions: current }).expect(200);
    });
  });

  describe('quotations', () => {
    const draft = () =>
      manager.post('/billing/quotations').send({ clientId: 'c-mine', branchCode: 'dubai' });
    const line = (id: string, body: Record<string, unknown>) =>
      manager.post(`/billing/quotations/${id}/lines`).send(body);

    it('takes a second and third line, with and without a discount', async () => {
      const id = (await draft().expect(201)).body.id;
      await line(id, {
        serviceCode: 'ct_return',
        descriptionEn: 'Corporation tax return',
        descriptionAr: 'إقرار ضريبة الشركات',
        amountMinor: 50_000,
        vat: 'out_of_scope',
      }).expect(201);
      await line(id, {
        descriptionEn: 'Bookkeeping',
        amountMinor: 30_000,
        discountMinor: 5_000,
        vat: 'standard',
      }).expect(201);
      const third = await line(id, {
        descriptionEn: 'Advice',
        hours: 2,
        perHourMinor: 30_000,
        vat: 'standard',
      }).expect(201);

      expect(third.body.lines).toHaveLength(3);
      // 500 + (300 − 50) + 600 = 1,350, VAT on the last two only.
      expect(third.body.net.minorUnits).toBe(135_000);
    });

    it('emails the client at the address on their details card when no contact has one', async () => {
      const id = (await draft().expect(201)).body.id;
      await line(id, { descriptionEn: 'x', amountMinor: 1_000, vat: 'out_of_scope' }).expect(201);
      await manager.post(`/billing/quotations/${id}/send`).send({ deliver: true }).expect(409);

      await manager
        .patch('/clients/c-mine/details')
        .send({ contactEmail: 'accounts@gulf.example' })
        .expect(200);
      const id2 = (await draft().expect(201)).body.id;
      await line(id2, { descriptionEn: 'x', amountMinor: 1_000, vat: 'out_of_scope' }).expect(201);
      const sent = await manager
        .post(`/billing/quotations/${id2}/send`)
        .send({ deliver: true })
        .expect(201);
      expect(sent.body.sentVia).toBe('email');

      const [job] = await t.sql<{ to: string }[]>`
        SELECT payload->>'to' AS to FROM jobs WHERE payload->>'quotationId' = ${id2}
      `;
      expect(job?.to).toBe('accounts@gulf.example');
    });
  });

  describe('a branch’s logo and stamp', () => {
    const PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    it('keeps an uploaded image and prints it from the branch', async () => {
      const changed = await manager
        .patch('/branches/dubai')
        .send({ logoUrl: PNG, stampUrl: PNG })
        .expect(200);
      expect(changed.body).toMatchObject({ logoUrl: PNG, stampUrl: PNG });
    });

    it('takes a real-sized logo, a few hundred kilobytes', async () => {
      const logo = `data:image/png;base64,${'A'.repeat(400_000)}`;
      const changed = await manager.patch('/branches/ajman').send({ logoUrl: logo }).expect(200);
      expect(changed.body.logoUrl).toHaveLength(logo.length);
    });

    it('refuses something that is not an image, and one that is too large', async () => {
      await manager
        .patch('/branches/dubai')
        .send({ logoUrl: 'data:text/html;base64,PGgxPg==' })
        .expect(400);
      await manager.patch('/branches/dubai').send({ logoUrl: 'javascript:alert(1)' }).expect(400);
      const huge = `data:image/png;base64,${'A'.repeat(600_000)}`;
      await manager.patch('/branches/dubai').send({ logoUrl: huge }).expect(400);
    });
  });

  describe('who is on a job', () => {
    let job: string;

    beforeAll(async () => {
      await t.client('c-other', 'Noor Medical Supplies FZE');
      job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-other', service: 'emaratax_request' })
          .expect(201)
      ).body.id;
    });

    it('names the person responsible, and gives them the client to open', async () => {
      await accountant.get('/clients/c-other').expect(404);
      await manager
        .post(`/projects/${job}/assignees`)
        .send({ userId: accountant.userId, role: 'responsible' })
        .expect(201);

      const detail = await manager.get(`/projects/${job}`).expect(200);
      expect(detail.body.assignees).toEqual([
        expect.objectContaining({ userId: accountant.userId, role: 'responsible' }),
      ]);
      await accountant.get('/clients/c-other').expect(200);
      await accountant.get(`/projects/${job}`).expect(200);
    });

    it('keeps one responsible: naming another makes the first a helper', async () => {
      const other = await t.another('accountant', 'second');
      await manager
        .post(`/projects/${job}/assignees`)
        .send({ userId: other.userId, role: 'responsible' })
        .expect(201);
      const roles = Object.fromEntries(
        (await manager.get(`/projects/${job}`).expect(200)).body.assignees.map(
          (a: { userId: string; role: string }) => [a.userId, a.role],
        ),
      );
      expect(roles).toEqual({ [accountant.userId]: 'collaborator', [other.userId]: 'responsible' });
    });

    it('takes somebody off, and refuses what makes no sense', async () => {
      await manager.delete(`/projects/${job}/assignees/${accountant.userId}`).expect(200);
      await manager.delete(`/projects/${job}/assignees/${accountant.userId}`).expect(404);
      await manager
        .post(`/projects/${job}/assignees`)
        .send({ userId: 'nobody', role: 'responsible' })
        .expect(409);
      await manager
        .post(`/projects/${job}/assignees`)
        .send({ userId: accountant.userId, role: 'boss' })
        .expect(400);
      await manager
        .post('/projects/missing/assignees')
        .send({ userId: accountant.userId, role: 'responsible' })
        .expect(404);
      await accountant
        .post(`/projects/${job}/assignees`)
        .send({ userId: accountant.userId, role: 'responsible' })
        .expect(403);
    });
  });

  describe('deleting a job', () => {
    it('deletes one nobody worked on, and records who did', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-mine', service: 'emaratax_request' })
          .expect(201)
      ).body.id;
      await manager.delete(`/projects/${job}`).expect(200);
      await manager.get(`/projects/${job}`).expect(404);
      const [row] = await t.sql<{ actor_user_id: string }[]>`
        SELECT actor_user_id FROM audit_log WHERE action = 'projects.project.deleted' AND entity_id = ${job}
      `;
      expect(row?.actor_user_id).toBe(manager.userId);
    });

    it('keeps one with recorded time, and says to cancel it instead', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-mine', service: 'tax_profile_update' })
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

      const refused = await manager.delete(`/projects/${job}`).expect(409);
      expect(refused.body.error.message).toContain('cancel it instead');
      await manager.get(`/projects/${job}`).expect(200);
    });

    it('is the manager’s', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-mine', service: 'penalty_waiver' })
          .expect(201)
      ).body.id;
      await accountant.delete(`/projects/${job}`).expect(403);
      await manager.delete('/projects/missing').expect(404);
    });
  });

  describe('re-opening a job', () => {
    it('re-opens a finished job with a reason, keeping its recorded time', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-mine', service: 'emaratax_request' })
          .expect(201)
      ).body.id;
      const start = await manager.get(`/projects/${job}`).expect(200);
      expect(start.body.state).toBe('ready');
      for (const to of ['in_progress', 'completed']) {
        const moved = await manager.post(`/projects/${job}/move`).send({ to });
        expect([moved.status, moved.body.error?.message]).toEqual([201, undefined]);
      }
      await manager
        .post('/timer/entries')
        .send({
          projectId: job,
          startedAt: '2026-09-04T09:00',
          endedAt: '2026-09-04T10:00',
          reason: 'Filed the request',
        })
        .expect(201);

      await manager.post(`/projects/${job}/move`).send({ to: 'in_progress' }).expect(400);
      const reopened = await manager
        .post(`/projects/${job}/move`)
        .send({ to: 'in_progress', reason: 'The authority asked for a correction' });
      expect([reopened.status, reopened.body.error?.message]).toEqual([201, undefined]);
      expect(reopened.body.state).toBe('in_progress');
      expect(reopened.body.recordedSeconds).toBe(3600);

      const [row] = await t.sql<{ after: { reason: string } }[]>`
        SELECT after FROM audit_log WHERE action = 'services.project.state_changed'
        AND entity_id = ${job} ORDER BY occurred_at DESC LIMIT 1
      `;
      expect(JSON.stringify(row?.after)).toContain('The authority asked for a correction');
    });

    it('brings a cancelled job back to ready', async () => {
      const job = (
        await manager
          .post('/projects')
          .send({ clientId: 'c-mine', service: 'deregistration' })
          .expect(201)
      ).body.id;
      await manager.post(`/projects/${job}/move`).send({ to: 'cancelled' }).expect(201);
      const back = await manager
        .post(`/projects/${job}/move`)
        .send({ to: 'ready', reason: 'Client went ahead after all' })
        .expect(201);
      expect(back.body.state).toBe('ready');
    });
  });

  describe('a shorter Saturday', () => {
    it('keeps different hours for one day, and only for a day that is worked', async () => {
      const person = await t.another('accountant', 'saturday');
      await manager
        .patch(`/staff/${person.userId}`)
        .send({
          workingHours: {
            startsAt: '09:00',
            endsAt: '18:00',
            days: [1, 2, 3, 4, 5, 6],
            dayHours: {
              6: { startsAt: '09:00', endsAt: '14:00' },
              7: { startsAt: '10:00', endsAt: '12:00' },
            },
          },
        })
        .expect(200);

      const staff = await manager.get('/staff').expect(200);
      const them = staff.body.staff.find((s: { id: string }) => s.id === person.userId);
      // Sunday is not worked, so hours for it are dropped.
      expect(them.workingHours.dayHours).toEqual({ 6: { startsAt: '09:00', endsAt: '14:00' } });
    });

    it('refuses a day that ends before it starts', async () => {
      const person = await t.another('accountant', 'backwards');
      await manager
        .patch(`/staff/${person.userId}`)
        .send({
          workingHours: {
            startsAt: '09:00',
            endsAt: '18:00',
            days: [6],
            dayHours: { 6: { startsAt: '14:00', endsAt: '09:00' } },
          },
        })
        .expect((response) => expect([400, 409]).toContain(response.status));
    });
  });
});
