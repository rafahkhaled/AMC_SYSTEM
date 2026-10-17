import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedInvoice } from '../testing/seed.js';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The lists an administrator edits, used for real (FR-03).
 *
 * Settings let somebody add "Establishment card" to the document types and it
 * appeared in the dropdown — and was then refused on upload, by a closed list
 * in the domain and another in a constraint on the table. Payment methods had
 * the same two. Only authorities worked. Nothing short of using a new option
 * would have found it, which is what each test here does.
 */
const PDF = Buffer.from('%PDF-1.4 test');

describe('the lists in Settings', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
    await t.client('c-lists', 'Gulf Trading LLC');
  });
  afterAll(async () => {
    await t.close();
  });

  const add = (list: string, code: string, nameEn = code) =>
    manager.post(`/lists/${list}`).send({ code, nameEn, nameAr: `${nameEn} (ar)` });

  describe('reading and changing them', () => {
    it('is readable by anybody signed in, since every dropdown needs it', async () => {
      for (const person of [manager, accountant, dataEntry]) {
        const response = await person.get('/lists').expect(200);
        const lists = new Set(response.body.options.map((o: { list: string }) => o.list));
        expect([...lists].sort()).toEqual([
          'authority',
          'document_type',
          'payment_method',
          'portal',
        ]);
      }
    });

    it('starts with what was in the code, so nothing changed on the day it shipped', async () => {
      const portals = await manager.get('/lists/portal').expect(200);
      expect(portals.body.options.map((o: { code: string }) => o.code)).toEqual([
        'emaratax',
        'ftaportal',
        'bank_portal',
        'other',
      ]);
    });

    it('adds an option, and then says so when the same code is added again', async () => {
      const first = await add(
        'document_type',
        'trade_name_certificate',
        'Trade name certificate',
      ).expect(201);
      expect(first.body.options.map((o: { code: string }) => o.code)).toContain(
        'trade_name_certificate',
      );

      await add('document_type', 'trade_name_certificate').expect(409);
    });

    it('refuses a code that is not a code, and a list that does not exist', async () => {
      await add('document_type', 'Has Spaces').expect(400);
      await add('colours', 'red').expect(404);
    });

    it('retires an option and brings it back, leaving it readable throughout', async () => {
      await add('authority', 'dubai_chamber', 'Dubai Chamber').expect(201);
      await manager.patch('/lists/authority/dubai_chamber').send({ retired: true }).expect(200);

      const after = await manager.get('/lists/authority').expect(200);
      const chamber = after.body.options.find((o: { code: string }) => o.code === 'dubai_chamber');
      // Still there, flagged: a document filed under it has to keep its label.
      expect(chamber).toMatchObject({ retired: true });

      await manager.patch('/lists/authority/dubai_chamber').send({ retired: false }).expect(200);
    });

    it('does not let anybody but a manager change one', async () => {
      await accountant
        .post('/lists/portal')
        .send({ code: 'zz', nameEn: 'Z', nameAr: 'ز' })
        .expect(403);
      await dataEntry.patch('/lists/portal/other').send({ retired: true }).expect(403);
    });
  });

  describe('a new document type, used', () => {
    const upload = (type: string, extra: Record<string, string> = {}) => {
      const call = manager.post('/clients/c-lists/documents').field('type', type);
      for (const [name, value] of Object.entries(extra)) call.field(name, value);
      return call.attach('file', PDF, 'scan.pdf');
    };

    it('is accepted from the moment it is added', async () => {
      await add('document_type', 'establishment_card', 'Establishment card').expect(201);
      const stored = await upload('establishment_card').expect(201);
      expect(stored.body.documents.map((d: { type: string }) => d.type)).toContain(
        'establishment_card',
      );
    });

    it('is refused when it was never on the list', async () => {
      const refused = await upload('made_up').expect(400);
      expect(refused.body.error.message).toContain('not a document type');
    });

    it('is refused once retired, while what was filed under it stays', async () => {
      await add('document_type', 'old_form', 'Old form').expect(201);
      await upload('old_form').expect(201);
      await manager.patch('/lists/document_type/old_form').send({ retired: true }).expect(200);

      await upload('old_form', { label: 'again' }).expect(400);
      const detail = await manager.get('/clients/c-lists').expect(200);
      expect(detail.body.documents.map((d: { type: string }) => d.type)).toContain('old_form');
    });

    it('still insists on an expiry date for a trade licence', async () => {
      const refused = await upload('trade_licence').expect(400);
      expect(refused.body.error.message).toContain('needs an expiry date');
    });

    it('says why a replacement was refused, and leaves the document it would replace alone', async () => {
      // This used to be a 500: the old licence was marked replaced before the
      // new one was checked, and the deferred foreign key failed at commit.
      await upload('trade_licence', { expiresOn: '2027-03-31' }).expect(201);
      const refused = await upload('trade_licence').expect(400);
      expect(refused.body.error.message).toContain('needs an expiry date');

      const detail = await manager.get('/clients/c-lists').expect(200);
      const licences = detail.body.documents.filter(
        (d: { type: string }) => d.type === 'trade_licence',
      );
      expect(licences).toHaveLength(1);
      expect(licences[0].expiresOn).toContain('2027-03-31');
    });

    it('takes an authority added in Settings', async () => {
      await add('authority', 'ajman_free_zone', 'Ajman Free Zone').expect(201);
      const stored = await upload('other', {
        label: 'permit',
        authority: 'ajman_free_zone',
      }).expect(201);
      expect(
        stored.body.documents.find((d: { label: string | null }) => d.label === 'permit')
          ?.authority,
      ).toBe('ajman_free_zone');
    });
  });

  describe('a new payment method, used', () => {
    it('is accepted from the moment it is added, and refused before and after', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-lists',
        userId: manager.userId,
        id: 'inv-methods',
      });
      const pay = (method: string) =>
        manager
          .post(`/billing/invoices/${invoiceId}/payments`)
          .send({ amountMinor: 1000, receivedOn: '2026-10-11', method });

      // A refusal from the use case, which the API reports as a conflict.
      const before = await pay('crypto').expect(409);
      expect(before.body.error.message).toContain('not a way of paying');

      await add('payment_method', 'crypto', 'Crypto').expect(201);
      await pay('crypto').expect(201);

      await manager.patch('/lists/payment_method/crypto').send({ retired: true }).expect(200);
      await pay('crypto').expect(409);
    });
  });

  describe('a new portal, used', () => {
    const login = (kind: string) =>
      accountant
        .post('/clients/c-lists/credentials')
        .send({ kind, username: 'u@portal.ae', secret: 'S3cret-pass' });

    beforeAll(async () => {
      // The accountant reaches this client's vault.
      await t.sql`
        INSERT INTO client_staff_access (client_id, user_id, assigned_by)
        VALUES ('c-lists', ${accountant.userId}, ${manager.userId})
      `;
    });

    it('stores a login for a portal added in Settings, and refuses one that is not on the list', async () => {
      await login('mohre').expect(400);

      await add('portal', 'mohre', 'MOHRE').expect(201);
      const stored = await login('mohre').expect(201);
      expect(stored.body.credentials.map((c: { kind: string }) => c.kind)).toContain('mohre');

      await login('not_a_portal').expect(400);
    });
  });
});
