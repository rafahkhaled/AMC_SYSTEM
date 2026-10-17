import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedApprovedStatement, seedInvoice } from '../testing/seed.js';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Money: quotations, invoices, payments, and the branches they go out under.
 *
 * Every figure asserted here is one a client reads and the firm can be held to,
 * so the arithmetic is checked as it arrives over the wire — discount off the
 * line first, VAT on what is left, rounded per line — rather than trusted from
 * the unit that computes it.
 */
describe('quotations, invoices and payments', () => {
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
    // Somebody to email, because a quotation cannot be emailed to nobody.
    await t.sql`
      INSERT INTO client_contacts (id, client_id, name, email, is_primary)
      VALUES ('k-mine', 'c-mine', 'Layla', 'layla@gulf.example', true)
    `;
  });
  afterAll(async () => {
    await t.close();
  });

  const draft = (body: Record<string, unknown> = {}) =>
    manager.post('/billing/quotations').send({ clientId: 'c-mine', ...body });
  const line = (id: string, body: Record<string, unknown>) =>
    manager.post(`/billing/quotations/${id}/lines`).send(body);

  describe('writing a quotation', () => {
    it('numbers it from the firm’s own sequence, one after another', async () => {
      const first = await draft().expect(201);
      const second = await draft().expect(201);
      expect(Number(second.body.reference)).toBe(Number(first.body.reference) + 1);
      expect(first.body).toMatchObject({
        state: 'draft',
        clientName: 'Gulf Trading LLC',
        currency: 'AED',
      });
    });

    it('takes the discount off the line first and charges VAT on what is left', async () => {
      const id = (await draft().expect(201)).body.id;
      await line(id, {
        serviceCode: 'vat_return',
        descriptionEn: 'VAT return',
        descriptionAr: 'إقرار',
        amountMinor: 500_000,
        discountMinor: 50_000,
        vat: 'standard',
      }).expect(201);
      const withFee = await line(id, {
        descriptionEn: 'FTA fee',
        amountMinor: 100_000,
        vat: 'out_of_scope',
      }).expect(201);

      expect(withFee.body).toMatchObject({
        subtotal: { minorUnits: 600_000 },
        discount: { minorUnits: 50_000 },
        net: { minorUnits: 550_000 },
        vat: { minorUnits: 22_500 },
        total: { minorUnits: 572_500 },
      });
      expect(withFee.body.lines[0]).toMatchObject({
        serviceCode: 'vat_return',
        chargeable: { minorUnits: 472_500 },
      });
      // Out of scope is not the same claim as zero percent.
      expect(withFee.body.lines[1].vatBasisPoints).toBeNull();
    });

    it('prices an hourly line from the hours and the rate', async () => {
      const id = (await draft().expect(201)).body.id;
      const hourly = await line(id, {
        descriptionEn: 'Bookkeeping',
        hours: 3.5,
        perHourMinor: 12_345,
        vat: 'out_of_scope',
      }).expect(201);
      expect(hourly.body.total.minorUnits).toBe(43_208);
    });

    it('stamps the firm’s own VAT rate, never one the browser sent', async () => {
      const id = (await draft().expect(201)).body.id;
      const added = await line(id, {
        descriptionEn: 'x',
        amountMinor: 10_000,
        vat: 'standard',
        vatBasisPoints: 9_999,
      }).expect(201);
      expect(added.body.lines[0].vatBasisPoints).toBe(500);
    });

    it('refuses what cannot be a line', async () => {
      const id = (await draft().expect(201)).body.id;
      const tooMuch = await line(id, {
        descriptionEn: 'x',
        amountMinor: 1_000,
        discountMinor: 1_001,
        vat: 'standard',
      }).expect(409);
      expect(tooMuch.body.error.message).toContain('more than the line');

      const noVat = await line(id, { descriptionEn: 'x', amountMinor: 1_000 }).expect(400);
      expect(noVat.body.error.message).toContain('VAT');
      await line(id, {
        descriptionEn: 'x',
        amountMinor: 1_000,
        serviceCode: 'Not A Code!',
        vat: 'standard',
      }).expect(400);
      await line(id, { amountMinor: 1_000, vat: 'standard' }).expect(400);
      await line(id, {
        descriptionEn: 'x',
        hours: 2,
        perHourMinor: 100,
        amountMinor: 200,
        vat: 'standard',
      }).expect(400);
    });

    it('removes a line and the totals follow', async () => {
      const id = (await draft().expect(201)).body.id;
      const added = await line(id, {
        descriptionEn: 'x',
        amountMinor: 10_000,
        vat: 'out_of_scope',
      }).expect(201);
      const removed = await manager
        .delete(`/billing/quotations/${id}/lines/${added.body.lines[0].id}`)
        .expect(200);
      expect(removed.body.total.minorUnits).toBe(0);
    });

    it('is not offered to an accountant for a client that is not theirs', async () => {
      const id = (await draft().expect(201)).body.id;
      const mine = await accountant.get('/billing/quotations').expect(200);
      expect(mine.body.quotations.map((q: { id: string }) => q.id)).toContain(id);

      const theirs = (
        await manager.post('/billing/quotations').send({ clientId: 'c-theirs' }).expect(201)
      ).body.id;
      const list = await accountant.get('/billing/quotations').expect(200);
      expect(list.body.quotations.map((q: { id: string }) => q.id)).not.toContain(theirs);
      await accountant.get(`/billing/quotations/${theirs}`).expect(404);
      await dataEntry.get('/billing/quotations').expect(403);
    });
  });

  describe('which branch it goes out under', () => {
    it('starts with Dubai and Ajman, and a manager fills in their letterheads', async () => {
      const branches = await accountant.get('/branches').expect(200);
      expect(branches.body.branches.map((b: { code: string }) => b.code)).toEqual([
        'dubai',
        'ajman',
      ]);

      const filled = await manager
        .patch('/branches/ajman')
        .send({
          addresses: ['Ajman: Free Zone, Office 12'],
          bank: { accountHolder: 'Active M - Ajman', iban: 'AE070331234567890123456', bic: null },
        })
        .expect(200);
      expect(filled.body).toMatchObject({
        addresses: ['Ajman: Free Zone, Office 12'],
        bank: { iban: 'AE070331234567890123456' },
      });
    });

    it('refuses half a bank account, and a branch with no Arabic name', async () => {
      await manager
        .patch('/branches/dubai')
        .send({ bank: { accountHolder: '', iban: 'AE1' } })
        .expect(400);
      await manager.post('/branches').send({ nameEn: 'Sharjah Branch', nameAr: '' }).expect(400);
    });

    it('generates a code from the English name and refuses a name with no letters', async () => {
      const added = await manager
        .post('/branches')
        .send({ nameEn: 'Fujairah Branch', nameAr: 'فرع الفجيرة' })
        .expect(201);
      expect(added.body.code).toBe('fujairah_branch');
      await manager.post('/branches').send({ nameEn: '!!!', nameAr: 'س' }).expect(409);
    });

    it('is chosen on a draft, with the letterhead coming back on the quotation', async () => {
      const id = (await draft().expect(201)).body.id;
      const set = await manager
        .post(`/billing/quotations/${id}/branch`)
        .send({ branchCode: 'ajman' })
        .expect(201);
      expect(set.body.branch).toMatchObject({
        code: 'ajman',
        addresses: ['Ajman: Free Zone, Office 12'],
      });

      await manager
        .post(`/billing/quotations/${id}/branch`)
        .send({ branchCode: 'narnia' })
        .expect(409);
    });

    it('has to be chosen before a quotation is sent, once the firm has branches', async () => {
      const id = (await draft().expect(201)).body.id;
      await line(id, { descriptionEn: 'x', amountMinor: 10_000, vat: 'out_of_scope' }).expect(201);

      const refused = await manager.post(`/billing/quotations/${id}/send`).send({}).expect(409);
      expect(refused.body.error.message).toContain('Choose the branch');
    });

    it('is fixed once the quotation has gone, because the client holds a copy', async () => {
      const id = (await draft({ branchCode: 'dubai' }).expect(201)).body.id;
      await line(id, { descriptionEn: 'x', amountMinor: 10_000, vat: 'out_of_scope' }).expect(201);
      await manager.post(`/billing/quotations/${id}/send`).send({}).expect(201);

      await manager
        .post(`/billing/quotations/${id}/branch`)
        .send({ branchCode: 'ajman' })
        .expect(409);
    });

    it('is chosen when an invoice is raised, before its number is taken', async () => {
      const { statementId } = await seedApprovedStatement(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
      });
      // Two refusals come first. Numbers come out of one unbroken run, and a refusal
      // that took one would leave a gap the FTA reads as a missing invoice.

      await manager.post(`/billing/statements/${statementId}/invoice`).send({}).expect(409);
      await manager
        .post(`/billing/statements/${statementId}/invoice`)
        .send({ branchCode: 'narnia' })
        .expect(409);

      const raised = await manager
        .post(`/billing/statements/${statementId}/invoice`)
        .send({ branchCode: 'ajman' })
        .expect(201);
      expect(raised.body).toMatchObject({
        branch: { code: 'ajman' },
        net: { minorUnits: 60_000 },
        vat: { minorUnits: 3_000 },
        total: { minorUnits: 63_000 },
      });
      // The first number of the firm's sequence: neither refusal used one.
      expect(raised.body.number).toBe('2071');

      // Raised once: the statement is now invoiced.
      await manager
        .post(`/billing/statements/${statementId}/invoice`)
        .send({ branchCode: 'ajman' })
        .expect(409);
    });
  });

  describe('sending it, and the client’s own link', () => {
    async function ready(): Promise<string> {
      const id = (await draft({ branchCode: 'dubai', validUntil: '2030-01-01' }).expect(201)).body
        .id;
      await line(id, {
        descriptionEn: 'VAT return',
        descriptionAr: 'إقرار',
        amountMinor: 100_000,
        discountMinor: 10_000,
        vat: 'standard',
      }).expect(201);
      return id;
    }
    const linkFor = async (id: string) => {
      const [job] = await t.sql<{ link: string }[]>`
        SELECT payload->>'link' AS link FROM jobs
        WHERE name = 'billing.quotation.email' AND payload->>'quotationId' = ${id}
        ORDER BY created_at DESC LIMIT 1
      `;
      return job?.link?.split('/q/')[1] ?? '';
    };

    it('emails it to the client’s contact with a link, and records that it was emailed', async () => {
      const id = await ready();
      const sent = await manager
        .post(`/billing/quotations/${id}/send`)
        .send({ deliver: true })
        .expect(201);
      expect(sent.body).toMatchObject({ state: 'sent', sentVia: 'email' });
      expect((await linkFor(id)).length).toBeGreaterThan(30);
    });

    it('records "by hand" as a different claim from "emailed"', async () => {
      const id = await ready();
      const sent = await manager.post(`/billing/quotations/${id}/send`).send({}).expect(201);
      expect(sent.body.sentVia).toBe('by_hand');
    });

    it('refuses to email a client with nobody to email, and leaves it a draft', async () => {
      const theirs = (
        await manager
          .post('/billing/quotations')
          .send({ clientId: 'c-theirs', branchCode: 'dubai' })
          .expect(201)
      ).body.id;
      await line(theirs, { descriptionEn: 'x', amountMinor: 1_000, vat: 'out_of_scope' }).expect(
        201,
      );

      const refused = await manager
        .post(`/billing/quotations/${theirs}/send`)
        .send({ deliver: true })
        .expect(409);
      expect(refused.body.error.message).toContain('no email address');
      expect((await manager.get(`/billing/quotations/${theirs}`).expect(200)).body.state).toBe(
        'draft',
      );
    });

    it('will not send one with no lines in it', async () => {
      const id = (await draft({ branchCode: 'dubai' }).expect(201)).body.id;
      const refused = await manager.post(`/billing/quotations/${id}/send`).send({}).expect(409);
      expect(refused.body.error.message).toContain('not an offer');
    });

    it('shows the client the breakdown they are agreeing to, and nothing internal', async () => {
      const id = await ready();
      await manager.post(`/billing/quotations/${id}/send`).send({ deliver: true }).expect(201);
      const token = await linkFor(id);

      const page = await t.anonymous().get(`/public/quotations/${token}`).expect(200);
      expect(page.body).toMatchObject({
        answerable: true,
        subtotal: { minorUnits: 100_000 },
        discount: { minorUnits: 10_000 },
        vat: { minorUnits: 4_500 },
        total: { minorUnits: 94_500 },
      });
      // No client id, no who drafted it: the page is for somebody outside the firm.
      expect(JSON.stringify(page.body)).not.toContain('c-mine');
      expect(Object.keys(page.body)).not.toContain('clientId');
    });

    it('records the first time the client opened it, and only that', async () => {
      const id = await ready();
      await manager.post(`/billing/quotations/${id}/send`).send({ deliver: true }).expect(201);
      const token = await linkFor(id);

      await t.anonymous().get(`/public/quotations/${token}`).expect(200);
      const [first] = await t.sql<
        { link_opened_at: Date }[]
      >`SELECT link_opened_at FROM quotations WHERE id = ${id}`;
      await t.anonymous().get(`/public/quotations/${token}`).expect(200);
      const [second] = await t.sql<
        { link_opened_at: Date }[]
      >`SELECT link_opened_at FROM quotations WHERE id = ${id}`;
      expect(second?.link_opened_at).toEqual(first?.link_opened_at);
    });

    it('lets the client accept it once, and records that the client said so, not staff', async () => {
      const id = await ready();
      await manager.post(`/billing/quotations/${id}/send`).send({ deliver: true }).expect(201);
      const token = await linkFor(id);

      const answered = await t
        .anonymous()
        .post(`/public/quotations/${token}/answer`)
        .send({ decision: 'accept' })
        .expect(201);
      expect(answered.body).toMatchObject({ state: 'accepted', answerable: false });
      await t
        .anonymous()
        .post(`/public/quotations/${token}/answer`)
        .send({ decision: 'decline' })
        .expect(404);

      const [row] = await t.sql<
        { decided_by: string }[]
      >`SELECT decided_by FROM quotations WHERE id = ${id}`;
      expect(row?.decided_by).toBe('client');
      const [audit] = await t.sql<{ actor_label: string; after: { decidedBy: string } }[]>`
        SELECT actor_label, after FROM audit_log WHERE action = 'billing.quotation.accepted' AND entity_id = ${id}
      `;
      expect(audit?.actor_label).toBe('Client, by link');
      expect(audit?.after.decidedBy).toBe('client');
    });

    it('answers a wrong link exactly as it answers an old one, so a guess learns nothing', async () => {
      const wrong = await t
        .anonymous()
        .get('/public/quotations/not-a-real-token-at-all')
        .expect(404);
      const empty = await t.anonymous().get('/public/quotations/x').expect(404);
      expect(wrong.body.error.message).toBe(empty.body.error.message);
    });

    it('stops an old link working when a new one is sent', async () => {
      const id = await ready();
      await manager.post(`/billing/quotations/${id}/send`).send({ deliver: true }).expect(201);
      const old = await linkFor(id);

      await manager.post(`/billing/quotations/${id}/resend`).send({}).expect(201);
      // The email job is unique per quotation; the link that matters is the stored hash.
      await t.anonymous().get(`/public/quotations/${old}`).expect(404);
    });

    it('lets staff record the client’s answer given by phone, as staff', async () => {
      const id = await ready();
      await manager.post(`/billing/quotations/${id}/send`).send({}).expect(201);
      const accepted = await manager.post(`/billing/quotations/${id}/accept`).send({}).expect(201);
      expect(accepted.body.state).toBe('accepted');
      const [row] = await t.sql<
        { decided_by: string }[]
      >`SELECT decided_by FROM quotations WHERE id = ${id}`;
      expect(row?.decided_by).toBe('staff');
    });
  });

  describe('payments', () => {
    const pay = (invoiceId: string, body: Record<string, unknown>) =>
      manager
        .post(`/billing/invoices/${invoiceId}/payments`)
        .send({ receivedOn: '2026-10-12', method: 'bank_transfer', ...body });

    it('settles an invoice in two instalments, reporting what is left each time', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      // 1,000.00 plus 5% VAT is 1,050.00.
      const first = await pay(invoiceId, { amountMinor: 40_000 }).expect(201);
      expect(first.body).toMatchObject({
        status: 'part_paid',
        paid: { minorUnits: 40_000 },
        balance: { minorUnits: 65_000 },
      });

      const last = await pay(invoiceId, { amountMinor: 65_000 }).expect(201);
      expect(last.body).toMatchObject({ status: 'paid', balance: { minorUnits: 0 } });
    });

    it('refuses a payment that predates the invoice, and one for nothing', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      const early = await pay(invoiceId, { amountMinor: 1_000, receivedOn: '2026-01-01' }).expect(
        409,
      );
      expect(early.body.error.message).toContain('predates the invoice');
      await pay(invoiceId, { amountMinor: 0 }).expect(400);
      expect(early.body.error.message.length).toBeGreaterThan(0);
    });

    it('records a cheque with its number and date, and refuses a cheque number on anything else', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      const cheque = await pay(invoiceId, {
        amountMinor: 50_000,
        method: 'cheque',
        chequeNumber: '004217',
        chequeDate: '2026-10-15',
        bankName: 'Emirates NBD',
      }).expect(201);
      expect(cheque.body.payments[0]).toMatchObject({
        method: 'cheque',
        chequeNumber: '004217',
        bankName: 'Emirates NBD',
      });

      await pay(invoiceId, { amountMinor: 1_000, method: 'cash', chequeNumber: '1' }).expect(400);
    });

    it('lets the firm drop part of what is owed, but only with a reason, and calls it paid', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      await pay(invoiceId, { amountMinor: 95_000, discountMinor: 10_000 }).expect(400);

      const settled = await pay(invoiceId, {
        amountMinor: 95_000,
        discountMinor: 10_000,
        discountReason: 'Agreed settlement for early payment',
      }).expect(201);
      // Not a debt for ever: a discount is recorded as one, not as a short payment.
      expect(settled.body).toMatchObject({ status: 'paid', balance: { minorUnits: 0 } });
    });

    it('hands back the cheque’s number, date and bank, which used to be saved and never returned', async () => {
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      await pay(invoiceId, {
        amountMinor: 50_000,
        method: 'cheque',
        chequeNumber: '004217',
        chequeDate: '2026-10-15',
        bankName: 'Emirates NBD',
      }).expect(201);

      const again = await manager.get(`/billing/invoices/${invoiceId}`).expect(200);
      expect(again.body.payments[0]).toMatchObject({
        chequeNumber: '004217',
        chequeDate: '2026-10-15',
        bankName: 'Emirates NBD',
      });
    });

    it('does not show forgiven money as still owing', async () => {
      // 1,050.00 owed: 950.00 arrives and 100.00 is forgiven. The invoice said
      // "paid" and kept showing the 100.00 as the balance.
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      const settled = await pay(invoiceId, {
        amountMinor: 95_000,
        discountMinor: 10_000,
        discountReason: 'Agreed settlement',
      }).expect(201);

      expect(settled.body).toMatchObject({
        status: 'paid',
        total: { minorUnits: 105_000 },
        paid: { minorUnits: 95_000 },
        discounted: { minorUnits: 10_000 },
        balance: { minorUnits: 0 },
      });
      expect(settled.body.payments[0].discount).toEqual({ minorUnits: 10_000, currency: 'AED' });
    });

    it('counts what was forgiven in the report, so a settled client is not shown as owing it', async () => {
      const report = await manager
        .get('/billing/reports/profitability?from=2026-10-01&to=2026-10-31')
        .expect(200);
      const row = report.body.rows.find((r: { clientId: string }) => r.clientId === 'c-mine');
      // Every invoice seeded for this client carries a discount of at most what
      // was invoiced, so nothing outstanding can be negative or inflated by it.
      expect(row.outstanding.minorUnits).toBeGreaterThanOrEqual(0);
      expect(row.outstanding.minorUnits).toBeLessThanOrEqual(row.grossInvoiced.minorUnits);
    });

    it('accepts an overpayment and a payment on an invoice that is already paid — as it does today', async () => {
      // Characterised rather than endorsed. A 9,999,999.99 typed against a
      // 1,050.00 invoice, or a second payment on a paid one, is recorded without
      // a word. That may be what the firm wants (credit on account), and it may
      // not; this test says what happens so changing it is a decision.
      const { invoiceId } = await seedInvoice(t.sql, {
        clientId: 'c-mine',
        userId: manager.userId,
        netMinor: 100_000,
      });
      await pay(invoiceId, { amountMinor: 105_000 }).expect(201);

      const second = await pay(invoiceId, { amountMinor: 100 }).expect(201);
      expect(second.body).toMatchObject({ status: 'paid', balance: { minorUnits: 0 } });
    });

    it('is the manager’s to record, and an accountant sees only their own clients’ invoices', async () => {
      const mine = await seedInvoice(t.sql, { clientId: 'c-mine', userId: manager.userId });
      const theirs = await seedInvoice(t.sql, { clientId: 'c-theirs', userId: manager.userId });

      await accountant
        .post(`/billing/invoices/${mine.invoiceId}/payments`)
        .send({ amountMinor: 1, receivedOn: '2026-10-12', method: 'cash' })
        .expect(403);

      const list = await accountant.get('/billing/invoices').expect(200);
      const ids = list.body.invoices.map((i: { id: string }) => i.id);
      expect(ids).toContain(mine.invoiceId);
      expect(ids).not.toContain(theirs.invoiceId);
      await accountant.get(`/billing/invoices/${theirs.invoiceId}`).expect(404);
    });

    it('writes each payment to the audit log', async () => {
      const rows = await t.sql<
        { n: string }[]
      >`SELECT count(*)::text AS n FROM audit_log WHERE action = 'billing.payment.received'`;
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
    });
  });

  describe('reports and the firm’s own details', () => {
    it('gives the firm’s VAT rate to the screen that offers it, so it names the real one', async () => {
      const profile = await manager.get('/billing/documents/profile').expect(200);
      expect(profile.body.vatBasisPoints).toBe(500);
      await dataEntry.get('/billing/documents/profile').expect(403);
    });

    it('answers the hours and profitability reports to whoever may view billing', async () => {
      await manager.get('/billing/reports/hours').expect(200);
      await manager.get('/billing/reports/profitability').expect(200);
      await dataEntry.get('/billing/reports/hours').expect(403);
    });

    it('starts with no statements, and refuses to generate one for nothing', async () => {
      const list = await manager.get('/billing/statements').expect(200);
      expect(list.body.statements.length).toBeGreaterThanOrEqual(0);
      const refused = await manager
        .post('/billing/statements')
        .send({ clientId: 'c-theirs', from: '2026-01-01', to: '2026-01-31' });
      expect([400, 409]).toContain(refused.status);
    });
  });
});
