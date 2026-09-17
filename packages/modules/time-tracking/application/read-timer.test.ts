import type { TimeEntryView } from '@amc/contracts';
import { describe, expect, it } from 'vitest';
import { ReadTimer } from './read-timer.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-16T06:00:00Z');

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
  return {
    id: 'e-1',
    taskId: 't-1',
    clientName: 'Gulf Trading LLC',
    service: 'vat_return',
    startedAt: '2026-09-14T06:00:00.000Z',
    endedAt: '2026-09-14T08:00:00.000Z',
    seconds: 7200,
    billable: true,
    source: 'timer',
    locked: false,
    reviewReason: null,
    ...over,
  };
}

function reader(entries: TimeEntryView[]) {
  return new ReadTimer(
    {
      running: async () => null,
      entriesOn: async () => entries,
      entriesBetween: async () => entries,
    },
    { now: () => NOW },
  );
}

describe('a person’s week (FR-24)', () => {
  it('gives every day in the range, including the ones with nothing on them', async () => {
    /*
     * A blank row is the point. Somebody checking whether they forgot to
     * record Tuesday is looking for the gap, and a timesheet that omits the
     * empty days makes the gap invisible.
     */
    const sheet = await reader([entry()]).timesheet(
      'user-a',
      at('2026-09-14T00:00:00Z'),
      at('2026-09-21T00:00:00Z'),
    );

    expect(sheet.days).toHaveLength(7);
    expect(sheet.days.map((day) => day.day)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    expect(sheet.days[1]).toEqual({ day: '2026-09-15', seconds: 0, billableSeconds: 0 });
  });

  it('adds up a day from its entries', async () => {
    const sheet = await reader([
      entry({ id: 'a', seconds: 3600 }),
      entry({ id: 'b', seconds: 1800 }),
    ]).timesheet('user-a', at('2026-09-14T00:00:00Z'), at('2026-09-15T00:00:00Z'));

    expect(sheet.days[0]?.seconds).toBe(5400);
    expect(sheet.totalSeconds).toBe(5400);
  });

  it('keeps billable time apart from the rest', async () => {
    // The billable share is what a practice manages by, and time that cannot
    // be charged is still time somebody worked.
    const sheet = await reader([
      entry({ id: 'a', seconds: 3600, billable: true }),
      entry({ id: 'b', seconds: 3600, billable: false }),
    ]).timesheet('user-a', at('2026-09-14T00:00:00Z'), at('2026-09-15T00:00:00Z'));

    expect(sheet.totalSeconds).toBe(7200);
    expect(sheet.billableSeconds).toBe(3600);
    expect(sheet.days[0]?.billableSeconds).toBe(3600);
  });

  it('puts an entry on the day it started', async () => {
    // A span that runs past midnight belongs to the day the work began, which
    // is the day the person would look for it on.
    const sheet = await reader([
      entry({ startedAt: '2026-09-14T20:00:00.000Z', endedAt: '2026-09-15T01:00:00.000Z' }),
    ]).timesheet('user-a', at('2026-09-14T00:00:00Z'), at('2026-09-16T00:00:00Z'));

    expect(sheet.days[0]?.seconds).toBe(7200);
    expect(sheet.days[1]?.seconds).toBe(0);
  });

  it('returns the entries themselves as well as the totals', async () => {
    const sheet = await reader([entry()]).timesheet(
      'user-a',
      at('2026-09-14T00:00:00Z'),
      at('2026-09-15T00:00:00Z'),
    );
    expect(sheet.entries).toHaveLength(1);
  });

  it('reports an empty week rather than no days at all', async () => {
    const sheet = await reader([]).timesheet(
      'user-a',
      at('2026-09-14T00:00:00Z'),
      at('2026-09-21T00:00:00Z'),
    );

    expect(sheet.days).toHaveLength(7);
    expect(sheet.totalSeconds).toBe(0);
    expect(sheet.billableSeconds).toBe(0);
  });
});
