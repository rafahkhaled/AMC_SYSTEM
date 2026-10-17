import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Clients, and what hangs off them: the contact log, enquiries, the vault.
 *
 * The thread through all of it is scope. An accountant reaches the clients
 * assigned to them and nobody else's, and that has to hold at every door, not
 * just the one somebody remembered to check — so most tests here are asked
 * twice, once as somebody who may and once as somebody who may not.
 */
describe('clients, their conversations and their logins', () => {
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
  });
  afterAll(async () => {
    await t.close();
  });

  describe('the client list', () => {
    it('shows a manager every client', async () => {
      const list = await manager.get('/clients').expect(200);
      expect(list.body.clients.map((c: { id: string }) => c.id).sort()).toEqual([
        'c-mine',
        'c-theirs',
      ]);
    });

    it('shows an accountant only the clients assigned to them', async () => {
      const list = await accountant.get('/clients').expect(200);
      expect(list.body.clients.map((c: { id: string }) => c.id)).toEqual(['c-mine']);
    });

    it('shows data entry nobody, because they work from batches they are given', async () => {
      const list = await dataEntry.get('/clients').expect(200);
      expect(list.body.clients).toEqual([]);
    });

    it('answers a client out of scope exactly as it answers one that does not exist', async () => {
      // Anything else would confirm that a company is on the firm's books.
      const outOfScope = await accountant.get('/clients/c-theirs').expect(404);
      const missing = await accountant.get('/clients/no-such-client').expect(404);
      expect(outOfScope.body.error.message).toBe(missing.body.error.message);
      await accountant.get('/clients/c-mine').expect(200);
    });
  });

  describe('the conversation log', () => {
    const entry = {
      channel: 'call',
      direction: 'outbound',
      happenedAt: '2026-10-09T10:30',
      summary: 'Asked for the trade licence renewal',
    };

    it('records a conversation with a screenshot, with an Arabic file name intact', async () => {
      const call = manager.post('/clients/c-mine/contact-log');
      for (const [key, value] of Object.entries(entry)) call.field(key, value);
      const recorded = await call
        .attach('files', Buffer.from('png bytes'), 'محادثة.png')
        .expect(201);

      expect(recorded.body.entries[0]).toMatchObject({ channel: 'call', summary: entry.summary });
      expect(recorded.body.entries[0].attachments[0].name).toBe('محادثة.png');
    });

    it('lists it, newest first, with the time the conversation happened', async () => {
      const second = manager.post('/clients/c-mine/contact-log');
      for (const [key, value] of Object.entries({
        ...entry,
        happenedAt: '2026-10-10T09:00',
        summary: 'A later call',
      })) {
        second.field(key, value);
      }
      await second.expect(201);

      const log = await manager.get('/clients/c-mine/contact-log').expect(200);
      expect(log.body.entries.map((e: { summary: string }) => e.summary)).toEqual([
        'A later call',
        entry.summary,
      ]);
    });

    it('refuses an entry that says nothing, and one with a malformed time', async () => {
      await manager
        .post('/clients/c-mine/contact-log')
        .field('channel', 'call')
        .field('direction', 'outbound')
        .field('happenedAt', '2026-10-09T10:30')
        .field('summary', 'x')
        .expect(400);
      await manager
        .post('/clients/c-mine/contact-log')
        .field('channel', 'call')
        .field('direction', 'outbound')
        .field('happenedAt', 'yesterday')
        .field('summary', 'Spoke to them')
        .expect(400);
    });

    it('is not readable for a client that is not yours', async () => {
      const theirs = await accountant.get('/clients/c-theirs/contact-log').expect(200);
      expect(theirs.body.entries).toEqual([]);
    });
  });

  describe('enquiries', () => {
    const capture = (over: Record<string, unknown> = {}) =>
      manager
        .post('/leads')
        .send({ name: 'Al Wasl Trading', phone: '+971501234567', source: 'referral', ...over });

    const findLead = (
      board: { columns: { leads: { id: string; name: string }[] }[] },
      name: string,
    ) => board.columns.flatMap((column) => column.leads).find((lead) => lead.name === name);

    it('captures an enquiry into the first column', async () => {
      const board = await capture().expect(201);
      const lead = findLead(board.body, 'Al Wasl Trading');
      expect(lead).toBeDefined();
      expect(board.body.columns[0].leads.map((l: { name: string }) => l.name)).toContain(
        'Al Wasl Trading',
      );
    });

    it('needs a phone number or an email, because an enquiry nobody can ring is not one', async () => {
      const refused = await capture({ name: 'No Contact', phone: undefined }).expect(400);
      expect(refused.body.error.message).toContain('phone number or an email');
    });

    it('moves along the pipeline, and refuses a jump the pipeline does not allow', async () => {
      const board = await capture({ name: 'Mover LLC' }).expect(201);
      const id = findLead(board.body, 'Mover LLC')?.id;

      await manager.post(`/leads/${id}/move`).send({ to: 'contacted' }).expect(201);
      const refused = await manager.post(`/leads/${id}/move`).send({ to: 'new' }).expect(400);
      expect(refused.body.error.message.length).toBeGreaterThan(0);
    });

    it('turns a quoted enquiry into a client the quotation can belong to, once', async () => {
      const board = await capture({ name: 'Quote Me LLC' }).expect(201);
      const id = findLead(board.body, 'Quote Me LLC')?.id;
      await manager.post(`/leads/${id}/move`).send({ to: 'contacted' }).expect(201);

      const quoted = await manager
        .post(`/leads/${id}/quote`)
        .send({ legalName: 'Quote Me LLC' })
        .expect(201);
      expect(quoted.body.clientId).toBeTruthy();
      const [client] = await t.sql<
        { legal_name: string }[]
      >`SELECT legal_name FROM clients WHERE id = ${quoted.body.clientId}`;
      expect(client?.legal_name).toBe('Quote Me LLC');

      // Confirming it later reuses the client, not a second one.
      const converted = await manager
        .post(`/leads/${id}/convert`)
        .send({ legalName: 'Quote Me LLC' })
        .expect(201);
      expect(converted.body.clientId).toBe(quoted.body.clientId);
      const [count] = await t.sql<
        { n: string }[]
      >`SELECT count(*)::text AS n FROM clients WHERE legal_name = 'Quote Me LLC'`;
      expect(count?.n).toBe('1');
    });

    it('keeps the pipeline to those who work with clients', async () => {
      await accountant
        .post('/leads')
        .send({ name: 'X', phone: '1', source: 'referral' })
        .expect(403);
    });
  });

  describe('the vault of portal logins', () => {
    const login = { kind: 'emaratax', username: 'gulf@portal.ae', secret: 'S3cret-Passw0rd!' };

    it('keeps a login, and never puts the password in a list', async () => {
      const stored = await accountant.post('/clients/c-mine/credentials').send(login).expect(201);
      expect(JSON.stringify(stored.body)).not.toContain(login.secret);

      const listed = await accountant.get('/clients/c-mine/credentials').expect(200);
      expect(listed.body.credentials[0]).toMatchObject({
        kind: 'emaratax',
        username: login.username,
      });
      expect(JSON.stringify(listed.body)).not.toContain(login.secret);
    });

    it('never writes the password anywhere readable in the database', async () => {
      const rows = await t.sql`SELECT * FROM client_credentials`;
      expect(JSON.stringify(rows)).not.toContain(login.secret);
    });

    it('will not reveal a password without a reason', async () => {
      const id = (await accountant.get('/clients/c-mine/credentials').expect(200)).body
        .credentials[0].id;
      await accountant.post(`/clients/c-mine/credentials/${id}/reveal`).send({}).expect(400);
      await accountant
        .post(`/clients/c-mine/credentials/${id}/reveal`)
        .send({ reason: 'x' })
        .expect(400);
    });

    it('reveals it with a reason, and the read is in the audit log with that reason', async () => {
      const id = (await accountant.get('/clients/c-mine/credentials').expect(200)).body
        .credentials[0].id;
      const revealed = await accountant
        .post(`/clients/c-mine/credentials/${id}/reveal`)
        .send({ reason: 'Filing the Q3 VAT return' })
        .expect(201);
      expect(revealed.body).toEqual({ username: login.username, secret: login.secret });

      const [row] = await t.sql<{ actor_user_id: string; after: { reason: string } }[]>`
        SELECT actor_user_id, after FROM audit_log WHERE action = 'clients.credential.read'
      `;
      // Who read it, and why — written before the password was handed over.
      expect(row?.actor_user_id).toBe(accountant.userId);
      expect(row?.after.reason).toBe('Filing the Q3 VAT return');
    });

    it('is closed to data entry and to a manager’s client list alike when the client is not yours', async () => {
      await dataEntry.get('/clients/c-mine/credentials').expect(403);
      // An accountant reaches nothing of a client they are not assigned to.
      const theirs = await accountant.get('/clients/c-theirs/credentials').expect(200);
      expect(theirs.body.credentials).toEqual([]);
    });

    it('replaces a login by retiring the old one, keeping it', async () => {
      await accountant
        .post('/clients/c-mine/credentials')
        .send({ ...login, secret: 'N3w-Passw0rd!' })
        .expect(201);
      const [counts] = await t.sql<{ total: string; live: string }[]>`
        SELECT count(*)::text AS total, count(*) FILTER (WHERE retired_at IS NULL)::text AS live
        FROM client_credentials WHERE client_id = 'c-mine' AND kind = 'emaratax'
      `;
      expect(counts).toEqual({ total: '2', live: '1' });
    });

    it('records that a login was stored, replaced and retired, but never what it was', async () => {
      const live = (await accountant.get('/clients/c-mine/credentials').expect(200)).body
        .credentials[0].id;
      await accountant.delete(`/clients/c-mine/credentials/${live}`).expect(200);

      const rows = await t.sql<{ action: string; after: unknown }[]>`
        SELECT action, after FROM audit_log WHERE action LIKE 'clients.credential.%'
        AND action <> 'clients.credential.read' ORDER BY occurred_at
      `;
      const actions = rows.map((row) => row.action);
      expect(actions.filter((a) => a === 'clients.credential.stored')).toHaveLength(2);
      // The first was retired when the second replaced it, the second just now.
      expect(actions.filter((a) => a === 'clients.credential.retired')).toHaveLength(2);

      const everything = JSON.stringify(rows);
      for (const secret of [login.secret, 'N3w-Passw0rd!', 'sealed', 'secret_sealed']) {
        expect(everything).not.toContain(secret);
      }
    });
  });

  describe('client details', () => {
    const path = '/clients/c-mine/details';

    it('keeps the contact, the numbers and the weekly day off, and shows them back', async () => {
      await manager
        .patch(path)
        .send({
          tradeLicenceNumber: 'CN-1234567',
          contactPerson: 'Mariam Al Suwaidi',
          contactEmail: 'mariam@gulf.example',
          mobile: '050 123 4567',
          landline: '04 123 4567',
          weeklyDayOff: 0,
          references: [
            { label: 'Establishment card', value: '1/2/3456' },
            { label: 'MOL number', value: '99887766' },
          ],
        })
        .expect(200);

      const detail = (await accountant.get('/clients/c-mine').expect(200)).body;
      expect(detail).toMatchObject({
        tradeLicenceNumber: 'CN-1234567',
        contactPerson: 'Mariam Al Suwaidi',
        contactEmail: 'mariam@gulf.example',
        mobile: '050 123 4567',
        landline: '04 123 4567',
        weeklyDayOff: 0,
      });
      expect(detail.references).toEqual([
        { label: 'Establishment card', value: '1/2/3456' },
        { label: 'MOL number', value: '99887766' },
      ]);
    });

    it('changes only what was sent, and clears what was sent as null', async () => {
      await manager.patch(path).send({ mobile: null }).expect(200);
      const detail = (await manager.get('/clients/c-mine').expect(200)).body;
      expect(detail.mobile).toBeNull();
      expect(detail.contactPerson).toBe('Mariam Al Suwaidi');
    });

    it('refuses what is not an email, not a phone number, or not a day', async () => {
      await manager.patch(path).send({ contactEmail: 'not-an-email' }).expect(409);
      await manager.patch(path).send({ mobile: 'abc' }).expect(409);
      await manager.patch(path).send({ weeklyDayOff: 9 }).expect(400);
      await manager
        .patch(path)
        .send({
          references: [
            { label: 'MOL', value: '1' },
            { label: 'mol', value: '2' },
          ],
        })
        .expect(409);
    });

    it('registers a client for VAT with its cycle, then corrects the number', async () => {
      await manager
        .patch(path)
        .send({ vat: { trn: '100 111 222 333 003' } })
        .expect(409);
      const registered = await manager
        .patch(path)
        .send({ vat: { trn: '100111222333003', frequency: 'quarterly', anchorEndMonth: 3 } })
        .expect(200);
      expect(registered.body).toMatchObject({
        vatState: 'registered',
        vatTrn: '100111222333003',
        vatPeriodEndMonths: [3, 6, 9, 12],
      });

      const fixed = await manager
        .patch(path)
        .send({ vat: { trn: '100111222333004' } })
        .expect(200);
      expect(fixed.body.vatTrn).toBe('100111222333004');
      await manager
        .patch(path)
        .send({ vat: { trn: '12345' } })
        .expect(409);
    });

    it('will not give two clients the same VAT number', async () => {
      await manager
        .patch('/clients/c-theirs/details')
        .send({ vat: { trn: '100111222333004', frequency: 'monthly', anchorEndMonth: 1 } })
        .expect(409);
    });

    it('registers for corporation tax with the financial year end', async () => {
      await manager
        .patch(path)
        .send({ corporateTax: { trn: '100999888777003' } })
        .expect(409);
      const done = await manager
        .patch(path)
        .send({ corporateTax: { trn: '100999888777003', financialYearEndMonth: 12 } })
        .expect(200);
      expect(done.body).toMatchObject({ ctState: 'registered', ctTrn: '100999888777003' });
    });

    it('is for people who may edit clients, and for clients they can reach', async () => {
      await accountant.patch(path).send({ mobile: '050 123 4567' }).expect(403);
      await dataEntry.patch(path).send({ mobile: '050 123 4567' }).expect(403);
      await manager.patch('/clients/nobody/details').send({ mobile: '050 123 4567' }).expect(404);
    });

    it('writes who changed what, without copying the phone number into the log', async () => {
      const rows = await t.sql<{ action: string; after: unknown }[]>`
        SELECT action, after FROM audit_log
        WHERE action IN ('clients.client.details_changed', 'clients.client.references_changed',
                         'clients.client.vat_registered', 'clients.client.trn_corrected')
      `;
      const actions = rows.map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'clients.client.details_changed',
          'clients.client.references_changed',
          'clients.client.vat_registered',
          'clients.client.trn_corrected',
        ]),
      );
      expect(JSON.stringify(rows)).not.toContain('050 123 4567');
    });
  });
});
