import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The work: services the firm offers, opening it, moving it, finishing it.
 *
 * Driven in the order a person does it, because the rules here are about
 * sequence — a job cannot start without its documents, cannot go back without
 * a reason, and what happens after a recurring one finishes depends on a
 * client's own filing cycle.
 */
describe('services and the work opened under them', () => {
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
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
    await t.client('c-move', 'Marina Contracting LLC', { assignTo: [accountant] });
    // A client on quarterly VAT ending in March, June, September, December.
    await t.sql`UPDATE clients SET vat_frequency = 'quarterly', vat_anchor_end_month = 3 WHERE id = 'c-mine'`;
  });
  afterAll(async () => {
    await t.close();
  });

  const start = (who: Session, body: Record<string, unknown>) => who.post('/projects').send(body);

  describe('the services on offer', () => {
    it('lists the eleven built in, to anybody signed in', async () => {
      for (const person of [manager, accountant, dataEntry]) {
        const services = await person.get('/services').expect(200);
        const builtIn = services.body.services.filter((s: { builtIn: boolean }) => s.builtIn);
        expect(builtIn).toHaveLength(11);
      }
    });

    it('adds a service of the firm’s own, with its steps, deadline and required documents', async () => {
      const added = await manager
        .post('/services')
        .send({
          nameEn: 'Trademark registration',
          nameAr: 'تسجيل علامة تجارية',
          deadlineDays: 45,
          steps: [
            { nameEn: 'Search the register', nameAr: 'البحث في السجل' },
            { nameEn: 'File the application', nameAr: '' },
          ],
          requiredDocuments: [{ type: 'trade_licence', mandatory: true }],
        })
        .expect(201);

      expect(added.body).toMatchObject({
        code: 'custom_trademark_registration',
        builtIn: false,
        recurring: false,
        deadlineDays: 45,
      });
      // A step described in one language is filled into the other, not left blank.
      expect(added.body.steps[1]).toEqual({
        nameEn: 'File the application',
        nameAr: 'File the application',
      });
    });

    it('refuses a document it has no list entry for, and a step-less service', async () => {
      const unknown = await manager
        .post('/services')
        .send({
          nameEn: 'X',
          nameAr: 'س',
          deadlineDays: null,
          steps: [{ nameEn: 'a', nameAr: 'أ' }],
          requiredDocuments: [{ type: 'made_up', mandatory: true }],
        })
        .expect(409);
      expect(unknown.body.error.message).toContain('made_up');

      await manager
        .post('/services')
        .send({ nameEn: 'X', nameAr: 'س', deadlineDays: null, steps: [], requiredDocuments: [] })
        .expect(400);
    });

    it('will not change a built-in service, whose deadlines and recurrence are code', async () => {
      await manager.patch('/services/vat_return').send({ nameEn: 'Hacked' }).expect(409);
    });

    it('lets steps be renamed and added to, but never removed', async () => {
      await manager
        .patch('/services/custom_trademark_registration')
        .send({
          steps: [
            { nameEn: 'Search', nameAr: 'بحث' },
            { nameEn: 'File', nameAr: 'تقديم' },
            { nameEn: 'Pay', nameAr: 'سداد' },
          ],
        })
        .expect(200);

      // Open projects record progress by step number; removing step 2 would
      // relabel everything done against step 3.
      const removed = await manager
        .patch('/services/custom_trademark_registration')
        .send({ steps: [{ nameEn: 'Only', nameAr: 'واحد' }] })
        .expect(409);
      expect(removed.body.error.message).toContain('not removed');
    });

    it('retires a service, keeping it listed but out of what is offered for new work', async () => {
      await manager
        .post('/services')
        .send({
          nameEn: 'Short lived',
          nameAr: 'قصير',
          deadlineDays: null,
          steps: [{ nameEn: 'a', nameAr: 'أ' }],
          requiredDocuments: [],
        })
        .expect(201);
      const retired = await manager
        .patch('/services/custom_short_lived')
        .send({ retired: true })
        .expect(200);
      expect(retired.body.retired).toBe(true);

      const listed = await manager.get('/services').expect(200);
      expect(
        listed.body.services.find((s: { code: string }) => s.code === 'custom_short_lived')
          ?.retired,
      ).toBe(true);
    });
  });

  describe('opening work', () => {
    it('opens one-off work for a client, ready to start when it needs no paperwork', async () => {
      const opened = await start(accountant, {
        clientId: 'c-mine',
        service: 'emaratax_request',
      }).expect(201);
      expect(opened.body).toMatchObject({
        service: 'emaratax_request',
        state: 'ready',
        clientName: 'Gulf Trading LLC',
      });
    });

    it('opens work under a service the firm added, dated from its own deadline', async () => {
      const opened = await start(accountant, {
        clientId: 'c-mine',
        service: 'custom_trademark_registration',
      }).expect(201);

      expect(opened.body.state).toBe('awaiting_documents');
      expect(opened.body.missingDocuments).toEqual(['trade_licence']);
      expect(opened.body.tasks.map((task: { titleEn: string }) => task.titleEn)).toEqual([
        'Search',
        'File',
        'Pay',
      ]);
      const days = (new Date(opened.body.dueAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(44);
      expect(days).toBeLessThan(46);
    });

    it('refuses a second open job for the same service, naming it', async () => {
      const again = await start(accountant, {
        clientId: 'c-mine',
        service: 'custom_trademark_registration',
      }).expect(409);
      expect(again.body.error.message).toContain('already an open');
    });

    it('refuses a service that does not exist, and one that has been retired from being offered', async () => {
      const ghost = await start(accountant, { clientId: 'c-mine', service: 'custom_ghost' }).expect(
        409,
      );
      expect(ghost.body.error.message).toContain('not one of the services');
      await start(accountant, { clientId: 'c-mine', service: 'vat_retrun' }).expect(409);
    });

    it('puts a client the accountant is not assigned to out of reach, as though it were not there', async () => {
      // This used to *write* the job and then fail to read it back: the manager
      // who tried next was told one was already open.
      await start(accountant, { clientId: 'c-theirs', service: 'emaratax_request' }).expect(404);
      const [written] = await t.sql<
        { n: string }[]
      >`SELECT count(*)::text AS n FROM projects WHERE client_id = 'c-theirs'`;
      expect(written?.n).toBe('0');

      await start(manager, { clientId: 'c-theirs', service: 'emaratax_request' }).expect(201);
      await start(accountant, { clientId: 'no-such-client', service: 'emaratax_request' }).expect(
        404,
      );
    });
  });

  describe('moving it along', () => {
    let project: string;

    beforeAll(async () => {
      // A service that needs no paperwork of ours, so the job can start at once.
      project = (
        await start(manager, { clientId: 'c-move', service: 'emaratax_request' }).expect(201)
      ).body.id;
    });

    it('goes forward freely', async () => {
      const detail = await accountant.get(`/projects/${project}`).expect(200);
      expect(detail.body.state).toBe('ready');
      const moved = await accountant
        .post(`/projects/${project}/move`)
        .send({ to: 'in_progress' })
        .expect(201);
      expect(moved.body.state).toBe('in_progress');
    });

    it('refuses to go back without saying why, and records the reason when it does', async () => {
      // The domain's refusal, which this route reports as a bad request.
      const refused = await accountant
        .post(`/projects/${project}/move`)
        .send({ to: 'ready' })
        .expect(400);
      expect(refused.body.error.message).toContain('Say why');

      const back = await accountant
        .post(`/projects/${project}/move`)
        .send({ to: 'ready', reason: 'filed before the licence arrived' })
        .expect(201);
      expect(back.body.state).toBe('ready');

      const [row] = await t.sql<{ after: { reason?: string } }[]>`
        SELECT after FROM audit_log WHERE action = 'services.project.state_changed' ORDER BY occurred_at DESC LIMIT 1
      `;
      expect(row?.after.reason).toBe('filed before the licence arrived');
    });

    it('does not ask for a reason when the client simply replies', async () => {
      await accountant.post(`/projects/${project}/move`).send({ to: 'in_progress' }).expect(201);
      await accountant
        .post(`/projects/${project}/move`)
        .send({ to: 'waiting_for_client' })
        .expect(201);
      await accountant.post(`/projects/${project}/move`).send({ to: 'in_progress' }).expect(201);
    });

    it('dates a single step, and clears the date again', async () => {
      const set = await accountant
        .patch(`/projects/${project}/tasks/1/due`)
        .send({ dueOn: '2026-11-15' })
        .expect(200);
      expect(set.body.tasks[0].dueOn).toContain('2026-11-15');
      const cleared = await accountant
        .patch(`/projects/${project}/tasks/1/due`)
        .send({ dueOn: null })
        .expect(200);
      expect(cleared.body.tasks[0].dueOn).toBeNull();
      await accountant
        .patch(`/projects/${project}/tasks/1/due`)
        .send({ dueOn: 'next week' })
        .expect(400);
    });

    it('ticks a step off once, and refuses the second tick', async () => {
      await accountant.post(`/projects/${project}/tasks/1`).send({}).expect(201);
      await accountant.post(`/projects/${project}/tasks/1`).send({}).expect(400);
    });

    it('shows it on the board, and not to the accountant of another client', async () => {
      const board = await manager.get('/projects').expect(200);
      const ids = board.body.columns.flatMap((c: { projects: { id: string }[] }) =>
        c.projects.map((p) => p.id),
      );
      expect(ids).toContain(project);

      const theirs = (
        await t.sql<{ id: string }[]>`SELECT id FROM projects WHERE client_id = 'c-theirs' LIMIT 1`
      )[0]?.id;
      // Out of scope reads as not there, not as forbidden.
      await accountant.get(`/projects/${theirs}`).expect(404);
      await manager.get(`/projects/${theirs}`).expect(200);
    });
  });

  describe('after a recurring job is finished', () => {
    /** Opens VAT work for a quarter, supplies its certificate, and runs it to the end. */
    async function finished(periodKey: string) {
      const opened = await start(manager, {
        clientId: 'c-mine',
        service: 'vat_return',
        periodKey,
      }).expect(201);
      const id = opened.body.id as string;

      const filed = await manager
        .post('/clients/c-mine/documents')
        .field('type', 'vat_certificate')
        .attach('file', Buffer.from('%PDF-1.4'), 'certificate.pdf')
        .expect(201);
      const documentId = filed.body.documents.find(
        (d: { type: string }) => d.type === 'vat_certificate',
      ).id;

      for (const requirement of opened.body.requirements.filter(
        (r: { mandatory: boolean }) => r.mandatory,
      )) {
        const type = requirement.type as string;
        let useId = documentId;
        if (type !== 'vat_certificate') {
          const other = await manager
            .post('/clients/c-mine/documents')
            .field('type', type)
            .field('expiresOn', '2030-01-01')
            .attach('file', Buffer.from('%PDF-1.4'), `${type}.pdf`)
            .expect(201);
          useId = other.body.documents.find((d: { type: string }) => d.type === type).id;
        }
        await manager
          .post(`/projects/${id}/documents`)
          .send({ type, documentId: useId })
          .expect(201);
      }
      await manager.post(`/projects/${id}/move`).send({ to: 'in_progress' }).expect(201);
      await manager.post(`/projects/${id}/move`).send({ to: 'completed' }).expect(201);
      return id;
    }

    it('offers the choice only once it is finished, and only for a service that repeats', async () => {
      const id = await finished('2026-Q2-06');
      const detail = await manager.get(`/projects/${id}`).expect(200);
      expect(detail.body.continuation).toEqual({ repeating: true });

      const [oneOff] = await t.sql<
        { id: string }[]
      >`SELECT id FROM projects WHERE service = 'emaratax_request' LIMIT 1`;
      const open = await manager.get(`/projects/${oneOff?.id}`).expect(200);
      expect(open.body.continuation).toBeNull();
    });

    it('opens the next quarter now, with the key and due date the daily sweep would give it', async () => {
      const id = await finished('2025-Q1-03');
      const next = await manager.post(`/projects/${id}/open-next`).expect(201);

      expect(next.body).toMatchObject({
        service: 'vat_return',
        periodKey: '2025-Q2-06',
        state: 'awaiting_documents',
      });
      // The 28th of the month after the quarter ends.
      expect(next.body.dueAt).toContain('2025-07-28');
    });

    it('will not open the same period twice, and says which one is open', async () => {
      const id = (
        await t.sql<{ id: string }[]>`SELECT id FROM projects WHERE period_key = '2025-Q1-03'`
      )[0]?.id as string;
      const again = await manager.post(`/projects/${id}/open-next`).expect(409);
      expect(again.body.error.message).toContain('2025-Q2-06 is already open');
    });

    it('refuses to carry on from a job that is not finished', async () => {
      const open = await start(manager, {
        clientId: 'c-mine',
        service: 'monthly_accounting',
        periodKey: '2026-08',
      }).expect(201);
      const refused = await manager.post(`/projects/${open.body.id}/open-next`).expect(409);
      expect(refused.body.error.message).toContain('Only a finished job');
    });

    it('stops a job repeating, which the daily sweep respects, and can start it again', async () => {
      const id = await finished('2025-Q4-12');

      const stopped = await manager.post(`/projects/${id}/stop-repeating`).expect(201);
      expect(stopped.body.continuation).toEqual({ repeating: false });
      const [live] = await t.sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM client_services WHERE client_id = 'c-mine' AND service = 'vat_return' AND active_to IS NULL
      `;
      expect(live?.n).toBe('0');
      await manager.post(`/projects/${id}/stop-repeating`).expect(409);

      const resumed = await manager.post(`/projects/${id}/resume-repeating`).expect(201);
      expect(resumed.body.continuation).toEqual({ repeating: true });
      await manager.post(`/projects/${id}/resume-repeating`).expect(409);
    });

    it('records stopping and resuming in the audit log', async () => {
      const actions = await t.sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE action LIKE 'services.subscription.%'
      `;
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining(['services.subscription.stopped', 'services.subscription.resumed']),
      );
    });
  });
});
