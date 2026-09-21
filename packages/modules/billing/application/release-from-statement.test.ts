import { Duration, Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Statement, type StatementLine } from '../domain/index.js';
import { ReleaseFromStatement } from './release-from-statement.js';
import { InMemoryStatements, RecordingAttachment } from './test-doubles.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

const manager = {
  userId: 'u-boss',
  permissions: new Set(['billing.release', 'clients.view.all']),
  roles: ['manager'],
  displayName: 'Wael Ajam',
};
const accountant = {
  userId: 'u-1',
  permissions: new Set(['clients.view.assigned']),
  roles: ['accountant'],
  displayName: 'Hana Saeed',
};

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 'sl-1',
  taskId: 't-1',
  service: 'vat_return',
  performedOn: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'u-1',
  worked: Duration.ofHours(2),
  perHour: aed(30_000),
  entryIds: ['e-1', 'e-2'],
  excluded: false,
  excludedReason: null,
  adjustedTo: null,
  adjustedReason: null,
  ...over,
});

async function harness(prepare: (statement: Statement) => void = () => {}) {
  const made = Statement.draft({
    id: 's-1',
    clientId: 'c-1',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T00:00:00.000Z'),
    currency: 'AED',
    lines: [line()],
    createdBy: 'u-9',
    now,
  });
  if (!made.ok) throw made.error;
  prepare(made.value);
  made.value.pullEvents();

  const statements = new InMemoryStatements();
  await statements.save(made.value);
  const attachment = new RecordingAttachment();

  return {
    release: new ReleaseFromStatement(statements, attachment),
    statements,
    attachment,
    statement: made.value,
  };
}

describe('taking hours back off a statement', () => {
  it('lets a manager do it, and frees every entry', async () => {
    const h = await harness();
    const released = await h.release.execute(manager, {
      statementId: 's-1',
      reason: 'billed the wrong period',
    });

    expect(released.ok).toBe(true);
    if (released.ok) expect(released.value.released).toBe(2);
    expect(h.attachment.released.sort()).toEqual(['e-1', 'e-2']);
    expect(h.statement.currentState).toBe('cancelled');
  });

  it('refuses anybody else', async () => {
    const h = await harness();
    const refused = await h.release.execute(accountant, {
      statementId: 's-1',
      reason: 'billed the wrong period',
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('Only a manager');
    // Nothing moved.
    expect(h.attachment.released).toHaveLength(0);
    expect(h.statement.currentState).toBe('draft');
  });

  it('refuses without a reason', async () => {
    const h = await harness();
    expect((await h.release.execute(manager, { statementId: 's-1', reason: ' ' })).ok).toBe(false);
  });

  it('refuses once the statement has been invoiced', async () => {
    const h = await harness((statement) => {
      statement.approve('u-boss', now);
      statement.markInvoiced(now);
    });

    // The client has the document. Releasing the hours behind it would leave
    // an invoice nobody can reconcile against any recorded work.
    const refused = await h.release.execute(manager, {
      statementId: 's-1',
      reason: 'billed the wrong period',
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('cancel or credit the invoice');
    expect(h.attachment.released).toHaveLength(0);
  });

  it('releases hours before it saves the cancellation', async () => {
    /*
     * If the release succeeds and the save fails, the hours are loose and the
     * statement still claims them — visible, and the next generation picks
     * them up. The other order leaves hours frozen against a cancelled
     * statement, which nothing will ever free.
     */
    const order: string[] = [];
    const h = await harness();
    const originalRelease = h.attachment.release.bind(h.attachment);
    h.attachment.release = async (ids) => {
      order.push('released');
      await originalRelease(ids);
    };
    const originalSave = h.statements.save.bind(h.statements);
    h.statements.save = async (statement) => {
      order.push('saved');
      await originalSave(statement);
    };

    await h.release.execute(manager, { statementId: 's-1', reason: 'billed the wrong period' });
    expect(order).toEqual(['released', 'saved']);
  });

  it('carries the reason into the event the audit log reads', async () => {
    const h = await harness();
    await h.release.execute(manager, { statementId: 's-1', reason: 'billed the wrong period' });

    const [event] = h.statement.pullEvents();
    expect(event?.name).toBe('billing.statement.cancelled');
    expect(event?.payload).toMatchObject({
      reason: 'billed the wrong period',
      releasedEntries: 2,
    });
  });

  it('says so when there is nothing attached', async () => {
    const made = Statement.draft({
      id: 's-2',
      clientId: 'c-1',
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T00:00:00.000Z'),
      currency: 'AED',
      lines: [line({ entryIds: [] })],
      createdBy: 'u-9',
      now,
    });
    if (!made.ok) throw made.error;

    const statements = new InMemoryStatements();
    await statements.save(made.value);
    const release = new ReleaseFromStatement(statements, new RecordingAttachment());

    expect((await release.execute(manager, { statementId: 's-2', reason: 'a reason' })).ok).toBe(
      false,
    );
  });

  it('says so when the statement is not there', async () => {
    const h = await harness();
    expect((await h.release.execute(manager, { statementId: 'nope', reason: 'a reason' })).ok).toBe(
      false,
    );
  });
});
