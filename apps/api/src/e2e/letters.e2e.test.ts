import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The firm's letters: written in Settings, generated for a client.
 *
 * Both halves are driven through the API because the interesting failures are
 * between them — a template saved with a typo that only shows when somebody
 * generates it six months later, a reworded letter that rewrites history, a
 * name that is markup.
 */
describe('letters', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
    await t.sql`UPDATE clients SET trade_licence_number = 'CN-1234567', legal_name_arabic = 'شركة الخليج للتجارة' WHERE id = 'c-mine'`;
  });
  afterAll(async () => {
    await t.close();
  });

  const wording = {
    nameEn: 'Salary certificate request',
    nameAr: 'طلب شهادة راتب',
    bodyEn: 'To: {{client_name}}\nLicence: {{trade_licence}}\nTRN: {{vat_trn}}\n{{signatory}}',
    bodyAr: 'إلى: {{client_name}}\nالرخصة: {{trade_licence}}\n{{signatory}}',
  };

  describe('writing them (feedback item 6)', () => {
    it('starts with the three the firm was given, offered to anybody who generates letters', async () => {
      const offered = await accountant.get('/letter-templates').expect(200);
      expect(offered.body.templates.map((x: { code: string }) => x.code).sort()).toEqual([
        'emaratax_authorisation',
        'engagement_letter',
        'vat_deregistration_request',
      ]);
    });

    it('adds a letter in both languages, and says which facts it needs', async () => {
      const added = await manager.post('/letter-templates').send(wording).expect(201);
      expect(added.body).toMatchObject({ code: 'salary_certificate_request', retired: false });
      expect([...added.body.needs].sort()).toEqual([
        'client_name',
        'signatory',
        'trade_licence',
        'vat_trn',
      ]);
      const offered = await accountant.get('/letter-templates').expect(200);
      expect(offered.body.templates.map((x: { code: string }) => x.code)).toContain(
        'salary_certificate_request',
      );
    });

    it('refuses a fact it cannot fill in, in either language, naming it and what it can fill in', async () => {
      // `renderLetter` would leave `{{client_nme}}` in the letter as written, and
      // it would go to a client with the braces still in it.
      const typo = await manager
        .post('/letter-templates')
        .send({ ...wording, nameEn: 'Typo', bodyEn: 'Dear {{client_nme}}' })
        .expect(409);
      expect(typo.body.error.message).toContain('{{client_nme}}');
      expect(typo.body.error.message).toContain('{{client_name}}');

      await manager
        .post('/letter-templates')
        .send({ ...wording, nameEn: 'Typo AR', bodyAr: 'إلى {{cleint}}' })
        .expect(409);
    });

    it('needs both names and both bodies', async () => {
      await manager
        .post('/letter-templates')
        .send({ ...wording, bodyAr: '' })
        .expect(400);
      await manager
        .post('/letter-templates')
        .send({ ...wording, nameAr: '' })
        .expect(400);
    });

    it('keeps two letters of one name apart', async () => {
      const second = await manager.post('/letter-templates').send(wording).expect(201);
      expect(second.body.code).toBe('salary_certificate_request_2');
    });

    it('is the manager’s to read in full and to change', async () => {
      const all = await manager.get('/letter-templates/all').expect(200);
      expect(all.body.templates[0]).toHaveProperty('bodyEn');
      await accountant.get('/letter-templates/all').expect(403);
      await accountant.post('/letter-templates').send(wording).expect(403);
    });

    it('can reword one of the three it started with', async () => {
      const changed = await manager
        .patch('/letter-templates/engagement_letter')
        .send({ bodyEn: 'Reworded for {{client_name}}' })
        .expect(200);
      expect(changed.body.bodyEn).toBe('Reworded for {{client_name}}');
      await manager
        .patch('/letter-templates/engagement_letter')
        .send({ bodyEn: 'Dear {{nobody}}' })
        .expect(409);
      await manager.patch('/letter-templates/no_such_letter').send({ retired: true }).expect(404);
    });
  });

  describe('making one for a client', () => {
    const make = (who: Session, client: string, body: Record<string, unknown>) =>
      who
        .post(`/clients/${client}/letters`)
        .send({ templateCode: 'salary_certificate_request', language: 'en', ...body });

    it('fills in the client’s own details from their record', async () => {
      const letter = await make(manager, 'c-mine', {}).expect(201);
      expect(letter.body.title).toBe('Salary certificate request');
      expect(letter.body.body).toContain('To: Gulf Trading LLC');
      expect(letter.body.body).toContain('Licence: CN-1234567');
    });

    it('writes in Arabic when asked, with the Arabic wording and title', async () => {
      const letter = await make(manager, 'c-mine', { language: 'ar' }).expect(201);
      expect(letter.body.title).toBe('طلب شهادة راتب');
      expect(letter.body.body).toContain('إلى: Gulf Trading LLC');
    });

    it('marks a fact it does not have with a visible gap, never a quiet blank', async () => {
      // A letter with an empty space where the tax number belongs reads as
      // finished and is not, and somebody signs it.
      const letter = await make(manager, 'c-mine', {}).expect(201);
      expect(letter.body.body).toContain('TRN: __________');
    });

    it('escapes what somebody typed, since a letter is rendered in a browser', async () => {
      await t.sql`UPDATE clients SET legal_name = '<script>alert(1)</script> & Sons' WHERE id = 'c-theirs'`;
      const letter = await make(manager, 'c-theirs', {}).expect(201);
      expect(letter.body.body).not.toContain('<script>');
      expect(letter.body.body).toContain('&lt;script&gt;');
      expect(letter.body.body).toContain('&amp; Sons');
    });

    it('records who it is addressed to, from the list of authorities', async () => {
      const letter = await make(manager, 'c-mine', { authority: 'fta' }).expect(201);
      expect(letter.body.authority).toBe('fta');
    });

    it('is refused for a letter that does not exist, and for a client that does not either', async () => {
      await make(manager, 'c-mine', { templateCode: 'nothing_like_it' }).expect(400);
      await make(manager, 'no-such-client', {}).expect(400);
    });

    it('is the manager’s to make, though an accountant reads their own client’s history', async () => {
      await make(accountant, 'c-mine', {}).expect(403);
      const history = await accountant.get('/clients/c-mine/letters').expect(200);
      expect(history.body.letters.length).toBeGreaterThan(0);
      const theirs = await accountant.get('/clients/c-theirs/letters').expect(200);
      expect(theirs.body.letters).toEqual([]);
    });
  });

  describe('changing a letter afterwards', () => {
    it('leaves the letters already produced saying what they said', async () => {
      const before = await make2('c-mine');
      await manager
        .patch('/letter-templates/salary_certificate_request')
        .send({ bodyEn: 'Completely new wording for {{client_name}}' })
        .expect(200);

      const after = await make2('c-mine');
      expect(after.body.body).toContain('Completely new wording');

      // A letter is a thing that was sent. Regenerating it from today's wording
      // would call a different letter the same one.
      const history = await manager.get('/clients/c-mine/letters').expect(200);
      const original = history.body.letters.find((l: { id: string }) => l.id === before.body.id);
      expect(original.body).toContain('To: Gulf Trading LLC');
      expect(original.body).not.toContain('Completely new wording');
    });

    it('stops offering a retired letter, while the history of it stays readable', async () => {
      await manager
        .patch('/letter-templates/salary_certificate_request')
        .send({ retired: true })
        .expect(200);

      const offered = await manager.get('/letter-templates').expect(200);
      expect(offered.body.templates.map((x: { code: string }) => x.code)).not.toContain(
        'salary_certificate_request',
      );
      await manager
        .post('/clients/c-mine/letters')
        .send({ templateCode: 'salary_certificate_request', language: 'en' })
        .expect(400);

      const history = await manager.get('/clients/c-mine/letters').expect(200);
      expect(
        history.body.letters.some(
          (l: { title: string }) => l.title === 'Salary certificate request',
        ),
      ).toBe(true);

      const all = await manager.get('/letter-templates/all').expect(200);
      expect(
        all.body.templates.find((x: { code: string }) => x.code === 'salary_certificate_request')
          .retired,
      ).toBe(true);
    });

    it('writes each change to the audit log', async () => {
      const rows = await t.sql<
        { action: string }[]
      >`SELECT action FROM audit_log WHERE action LIKE 'clients.letter_template.%'`;
      expect(rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'clients.letter_template.added',
          'clients.letter_template.changed',
          'clients.letter_template.retired',
        ]),
      );
    });

    function make2(client: string) {
      return manager
        .post(`/clients/${client}/letters`)
        .send({ templateCode: 'salary_certificate_request', language: 'en' })
        .expect(201);
    }
  });
});
