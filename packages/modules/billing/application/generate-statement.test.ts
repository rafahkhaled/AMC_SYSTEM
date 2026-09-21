import { Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { GenerateStatement } from './generate-statement.js';
import type { BillableWork } from './ports.js';
import {
  CountingIds,
  FakeClock,
  FakeRates,
  FakeUnbilledWork,
  InMemoryStatements,
  RecordingAttachment,
} from './test-doubles.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const day = (d: string) => new Date(`2026-09-${d}T00:00:00.000Z`);
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

const period = { from: day('01'), to: day('30') };

const work = (over: Partial<BillableWork> = {}): BillableWork => ({
  entryId: 'e-1',
  taskId: 't-1',
  service: 'vat_return',
  performedOn: day('03'),
  userId: 'u-1',
  seconds: 3600,
  ...over,
});

function harness(
  setUp: (parts: { unbilled: FakeUnbilledWork; rates: FakeRates }) => void = () => {},
) {
  const unbilled = new FakeUnbilledWork();
  const rates = new FakeRates();
  const statements = new InMemoryStatements();
  const attachment = new RecordingAttachment();
  setUp({ unbilled, rates });

  const generate = new GenerateStatement(
    unbilled,
    rates,
    statements,
    attachment,
    new FakeClock(now),
    new CountingIds(),
  );
  return { generate, statements, attachment, unbilled, rates };
}

describe('generating a statement', () => {
  it('prices the hours at the client rate', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([work({ seconds: 2 * 3600 })]);
    });

    const made = await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    expect(made.ok).toBe(true);

    const statement = h.statements.only();
    expect(statement.total().minorUnits).toBe(60_000);
    expect(statement.currentState).toBe('draft');
  });

  it('puts one line per task, day and person', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([
        work({ entryId: 'e-1', taskId: 't-1', performedOn: day('03'), userId: 'u-1' }),
        // Same task, same day, same person: one line, added together.
        work({ entryId: 'e-2', taskId: 't-1', performedOn: day('03'), userId: 'u-1' }),
        // Same task and day, different person.
        work({ entryId: 'e-3', taskId: 't-1', performedOn: day('03'), userId: 'u-2' }),
        // Same task and person, different day.
        work({ entryId: 'e-4', taskId: 't-1', performedOn: day('04'), userId: 'u-1' }),
        // Different task.
        work({ entryId: 'e-5', taskId: 't-2', performedOn: day('03'), userId: 'u-1' }),
      ]);
    });

    await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    const lines = h.statements.only().snapshot().lines;

    expect(lines).toHaveLength(4);
    const merged = lines.find((line) => line.entryIds.length === 2);
    expect(merged?.worked.seconds).toBe(7200);
    expect([...(merged?.entryIds ?? [])].sort()).toEqual(['e-1', 'e-2']);
  });

  it('bills each day at the rate that applied that day', async () => {
    const h = harness(({ unbilled, rates }) => {
      rates.from([
        { from: day('01'), perHour: aed(30_000) },
        // The firm raised its rate mid-month.
        { from: day('15'), perHour: aed(40_000) },
      ]);
      unbilled.returning([
        work({ entryId: 'e-1', performedOn: day('03'), taskId: 't-1' }),
        work({ entryId: 'e-2', performedOn: day('20'), taskId: 't-2' }),
      ]);
    });

    await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    const statement = h.statements.only();

    // An hour before and an hour after: 300 + 400, not 800 and not 600.
    expect(statement.total().minorUnits).toBe(70_000);
    const rates = statement
      .snapshot()
      .lines.map((line) => line.perHour.minorUnits)
      .sort();
    expect(rates).toEqual([30_000, 40_000]);
  });

  it('attaches every entry, so the same hour is not billed twice', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([work({ entryId: 'e-1' }), work({ entryId: 'e-2', taskId: 't-2' })]);
    });

    await h.generate.execute('u-9', { clientId: 'c-1', ...period });

    const attached = h.attachment.attached.flatMap((item) => [...item.entryIds]).sort();
    expect(attached).toEqual(['e-1', 'e-2']);
    // Every line got its own attachment call, keyed by the line it belongs to.
    expect(h.attachment.attached).toHaveLength(2);
  });

  it('attaches only after the statement is saved', async () => {
    // An entry pointing at a line that was never written is an hour frozen
    // against nothing. The other order fails safe.
    const order: string[] = [];
    const statements = new InMemoryStatements();
    const attachment = new RecordingAttachment();
    const originalSave = statements.save.bind(statements);
    statements.save = async (statement) => {
      order.push('saved');
      await originalSave(statement);
    };
    const originalAttach = attachment.attach.bind(attachment);
    attachment.attach = async (lineId, entryIds) => {
      order.push('attached');
      await originalAttach(lineId, entryIds);
    };

    const generate = new GenerateStatement(
      new FakeUnbilledWork().returning([work()]),
      new FakeRates(),
      statements,
      attachment,
      new FakeClock(now),
      new CountingIds(),
    );
    await generate.execute('u-9', { clientId: 'c-1', ...period });

    expect(order).toEqual(['saved', 'attached']);
  });

  it('refuses rather than raising a statement of nothing', async () => {
    const h = harness();
    const refused = await h.generate.execute('u-9', { clientId: 'c-1', ...period });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('no approved unbilled hours');
    // And nothing was written, so nobody has to clean up after it.
    expect(h.statements.saved).toHaveLength(0);
    expect(h.attachment.attached).toHaveLength(0);
  });

  it('ignores work outside the period', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([
        work({ entryId: 'inside', performedOn: day('15') }),
        work({ entryId: 'before', performedOn: new Date('2026-08-20T00:00:00.000Z') }),
        work({ entryId: 'after', performedOn: new Date('2026-10-05T00:00:00.000Z') }),
      ]);
    });

    await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    expect(h.statements.only().entryIds()).toEqual(['inside']);
  });

  it('refuses a period that ends before it starts', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([work()]);
    });
    const refused = await h.generate.execute('u-9', {
      clientId: 'c-1',
      from: day('30'),
      to: day('01'),
    });
    expect(refused.ok).toBe(false);
  });

  it('keeps the person on the line, because the client asks who did it', async () => {
    const h = harness(({ unbilled }) => {
      unbilled.returning([work({ userId: 'u-7', service: 'bookkeeping' })]);
    });

    await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    const [line] = h.statements.only().snapshot().lines;

    expect(line?.userId).toBe('u-7');
    expect(line?.service).toBe('bookkeeping');
    expect(line?.taskId).toBe('t-1');
  });

  it('handles work with nobody attached to it', async () => {
    // A person can be removed. The hours they logged still have to bill.
    const h = harness(({ unbilled }) => {
      unbilled.returning([work({ userId: null })]);
    });

    const made = await h.generate.execute('u-9', { clientId: 'c-1', ...period });
    expect(made.ok).toBe(true);
    expect(h.statements.only().snapshot().lines[0]?.userId).toBeNull();
  });
});
