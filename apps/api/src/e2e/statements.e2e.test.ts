import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * From an hour worked to an invoice, the whole way.
 *
 * Time recorded, approved, gathered into a statement, argued over line by line,
 * approved, and raised as an invoice. Each step hands the next something the
 * previous one could only promise, so this is the one test that would notice
 * the chain breaking between two parts that each pass alone.
 */
describe('time to statement to invoice', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let project: string;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
    project = (
      await accountant
        .post('/projects')
        .send({ clientId: 'c-mine', service: 'emaratax_request' })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await t.close();
  });

  const recordHours = (from: string, to: string, reason = 'Forgot to start the timer') =>
    accountant
      .post('/timer/entries')
      .send({ projectId: project, startedAt: from, endedAt: to, reason })
      .expect(201);

  async function approveAll() {
    const queue = await manager.get('/timer/approvals').expect(200);
    const ids = queue.body.entries.map((e: { id: string }) => e.id);
    if (ids.length > 0)
      await manager.post('/timer/entries/approve').send({ entryIds: ids }).expect(201);
  }

  it('gathers approved hours into a statement priced at the rate in force that day', async () => {
    await recordHours('2026-09-03T09:00', '2026-09-03T11:00');
    await approveAll();

    const statement = await manager
      .post('/billing/statements')
      .send({ clientId: 'c-mine', from: '2026-09-01', to: '2026-09-30' })
      .expect(201);
    expect(statement.body).toMatchObject({ state: 'draft', clientName: 'Gulf Trading LLC' });
    // Two hours at the firm's default 300.00 an hour.
    expect(statement.body.lines).toHaveLength(1);
    expect(statement.body.lines[0]).toMatchObject({
      workedSeconds: 7200,
      perHour: { minorUnits: 30_000 },
      amount: { minorUnits: 60_000 },
    });
    expect(statement.body.total.minorUnits).toBe(60_000);
  });

  it('leaves out hours nobody approved, and hours that are already on a statement', async () => {
    await recordHours('2026-09-04T09:00', '2026-09-04T10:00');
    // Not approved, so not billable yet; and the first day is already spoken for.
    const second = await manager
      .post('/billing/statements')
      .send({ clientId: 'c-mine', from: '2026-09-01', to: '2026-09-30' });
    expect([400, 409]).toContain(second.status);
  });

  describe('arguing over a line', () => {
    let statementId: string;
    let lineId: string;

    beforeAll(async () => {
      await approveAll();
      const draft = await manager.get('/billing/statements?clientId=c-mine').expect(200);
      statementId = draft.body.statements[0].id;
      lineId = (await manager.get(`/billing/statements/${statementId}`).expect(200)).body.lines[0]
        .id;
    });

    it('will not change a line without a reason, which is what makes the gap answerable', async () => {
      await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/revise`)
        .send({ adjustToMinor: 50_000 })
        .expect(400);
      await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/revise`)
        .send({ reason: 'x', adjustToMinor: 50_000 })
        .expect(400);
    });

    it('adjusts a line, showing what the clock said beside what will be billed', async () => {
      const revised = await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/revise`)
        .send({ reason: 'Agreed a reduced fee with the client', adjustToMinor: 50_000 })
        .expect(201);

      expect(revised.body.total.minorUnits).toBe(50_000);
      expect(revised.body.totalAsWorked.minorUnits).toBe(60_000);
      expect(revised.body.lines[0]).toMatchObject({
        adjustedTo: { minorUnits: 50_000 },
        adjustedReason: 'Agreed a reduced fee with the client',
      });
    });

    it('excludes a line outright, and an excluded line does not reach the invoice', async () => {
      const revised = await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/revise`)
        .send({ reason: 'Not chargeable: our own error' })
        .expect(201);
      expect(revised.body.lines[0].excluded).toBe(true);
      expect(revised.body.total.minorUnits).toBe(0);

      // Put it back, so the next test has something to bill.
      const back = await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/restore`)
        .expect(201);
      expect(back.body.lines[0].excluded).toBe(false);
      await manager.post(`/billing/statements/${statementId}/lines/${lineId}/restore`).expect(409);
    });

    it('cannot be raised as an invoice until it has been approved', async () => {
      const early = await manager
        .post(`/billing/statements/${statementId}/invoice`)
        .send({ branchCode: 'dubai' })
        .expect(409);
      expect(early.body.error.message).toContain('approved');
    });

    it('is approved once, by the manager, and then cannot be revised', async () => {
      await accountant.post(`/billing/statements/${statementId}/approve`).expect(403);
      const approved = await manager.post(`/billing/statements/${statementId}/approve`).expect(201);
      expect(approved.body).toMatchObject({
        state: 'approved',
        approvedBy: expect.stringContaining('manager'),
      });

      await manager
        .post(`/billing/statements/${statementId}/lines/${lineId}/revise`)
        .send({ reason: 'Too late to change', adjustToMinor: 1 })
        .expect(409);
    });

    it('becomes an invoice with VAT on top, and the hours are then spoken for', async () => {
      const invoice = await manager
        .post(`/billing/statements/${statementId}/invoice`)
        .send({ branchCode: 'dubai' })
        .expect(201);
      expect(invoice.body).toMatchObject({
        status: 'issued',
        branch: { code: 'dubai' },
        net: { minorUnits: 50_000 },
        vat: { minorUnits: 2_500 },
        total: { minorUnits: 52_500 },
      });
      expect(invoice.body.lines[0]).toMatchObject({ projectId: project, workedSeconds: 7200 });

      const settled = await manager.get(`/billing/statements/${statementId}`).expect(200);
      expect(settled.body.state).toBe('invoiced');
    });

    it('writes each step to the audit log', async () => {
      const rows = await t.sql<
        { action: string }[]
      >`SELECT action FROM audit_log WHERE action LIKE 'billing.%'`;
      expect(rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'billing.statement.line_revised',
          'billing.statement.line_restored',
          'billing.statement.invoiced',
          'billing.statement.approved',
          'billing.invoice.raised',
        ]),
      );
    });
  });

  describe('taking hours back', () => {
    it('is the manager’s to do, and needs a reason', async () => {
      await recordHours('2026-10-05T09:00', '2026-10-05T10:00', 'Late entry for the week');
      await approveAll();
      const draft = await manager
        .post('/billing/statements')
        .send({ clientId: 'c-mine', from: '2026-10-01', to: '2026-10-31' })
        .expect(201);

      await accountant
        .post(`/billing/statements/${draft.body.id}/release`)
        .send({ reason: 'Wrong client' })
        .expect(403);
      await manager
        .post(`/billing/statements/${draft.body.id}/release`)
        .send({ reason: '' })
        .expect(400);
      await manager
        .post(`/billing/statements/${draft.body.id}/release`)
        .send({ reason: 'Raised against the wrong client' })
        .expect(201);

      // The hours are free again, so the next statement can have them.
      const again = await manager
        .post('/billing/statements')
        .send({ clientId: 'c-mine', from: '2026-10-01', to: '2026-10-31' })
        .expect(201);
      expect(again.body.lines).toHaveLength(1);
    });
  });

  it('shows an accountant the statements of their own clients and not other people’s', async () => {
    const mine = await accountant.get('/billing/statements').expect(200);
    expect(mine.body.statements.every((s: { clientId: string }) => s.clientId === 'c-mine')).toBe(
      true,
    );
    await accountant
      .post('/billing/statements')
      .send({ clientId: 'c-mine', from: '2026-09-01', to: '2026-09-30' })
      .expect(403);
  });
});
