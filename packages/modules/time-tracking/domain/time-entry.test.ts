import { describe, expect, it } from 'vitest';
import { TimeEntry } from './time-entry.js';

const at = (iso: string) => new Date(iso);

function fromTimer(startedAt = '2026-04-01T09:00:00Z', endedAt = '2026-04-01T10:30:00Z') {
  const created = TimeEntry.fromTimer({
    id: 'entry-1',
    assignmentId: 'assign-1',
    startedAt: at(startedAt),
    endedAt: at(endedAt),
  });
  if (!created.ok) throw new Error('fixture');
  created.value.pullEvents();
  return created.value;
}

describe('recording time from the timer', () => {
  it('measures the span exactly', () => {
    expect(fromTimer().length.toHoursAndMinutes()).toBe('1:30');
  });

  it('is billable by default, because the opposite loses revenue quietly', () => {
    expect(fromTimer().billable).toBe(true);
  });

  it('refuses a span that ends before it started', () => {
    expect(
      TimeEntry.fromTimer({
        id: 'e',
        assignmentId: 'a',
        startedAt: at('2026-04-01T10:00:00Z'),
        endedAt: at('2026-04-01T09:00:00Z'),
      }).ok,
    ).toBe(false);
  });

  it('belongs to an assignment, not to a task and a person separately', () => {
    // Client, task and staff member are all reached through it, which is what
    // stops reassignment rewriting who did last month's work.
    expect(fromTimer().assignmentId).toBe('assign-1');
  });
});

describe('time entered by hand (FR-22)', () => {
  function manual(reason: string) {
    return TimeEntry.manual({
      id: 'entry-2',
      assignmentId: 'assign-1',
      startedAt: at('2026-04-01T09:00:00Z'),
      endedAt: at('2026-04-01T11:00:00Z'),
      reason,
    });
  }

  it('needs a reason', () => {
    expect(manual('').ok).toBe(false);
    expect(manual('x').ok).toBe(false);
    expect(manual('forgot to start the timer at the client office').ok).toBe(true);
  });

  it('is flagged as manual for ever', () => {
    const entry = manual('forgot to start the timer');
    // A month of manual entries means the timer is not being used, and that is
    // worth being able to see.
    expect(entry.ok && entry.value.source).toBe('manual');
  });

  it('refuses an entry of no length', () => {
    expect(
      TimeEntry.manual({
        id: 'e',
        assignmentId: 'a',
        startedAt: at('2026-04-01T09:00:00Z'),
        endedAt: at('2026-04-01T09:00:00Z'),
        reason: 'nothing happened',
      }).ok,
    ).toBe(false);
  });

  it('carries the reason into the audit trail', () => {
    const entry = manual('forgot to start the timer at the client office');
    if (!entry.ok) throw new Error('fixture');
    const event = entry.value.pullEvents().find((e) => e.name === 'time.entry.recorded');
    expect(event?.payload).toMatchObject({ source: 'manual' });
  });
});

describe('unusually long entries (FR-25)', () => {
  it('flags a sitting longer than twelve hours', () => {
    expect(fromTimer('2026-04-01T08:00:00Z', '2026-04-01T21:00:00Z').isImplausiblyLong).toBe(true);
  });

  it('leaves a long but ordinary day alone', () => {
    expect(fromTimer('2026-04-01T08:00:00Z', '2026-04-01T18:00:00Z').isImplausiblyLong).toBe(false);
  });
});

describe('adjusting time', () => {
  it('needs a reason, and keeps the before and after', () => {
    const entry = fromTimer();
    expect(
      entry.adjust({
        startedAt: at('2026-04-01T09:00:00Z'),
        endedAt: at('2026-04-01T10:00:00Z'),
        reason: 'the timer ran on after the meeting ended',
        now: at('2026-04-01T11:00:00Z'),
      }).ok,
    ).toBe(true);

    const event = entry.pullEvents().find((e) => e.name === 'time.entry.adjusted');
    expect(event?.payload).toMatchObject({
      before: { endedAt: '2026-04-01T10:30:00.000Z' },
      after: { endedAt: '2026-04-01T10:00:00.000Z' },
    });
  });

  it('turns an edited timer entry into a manual one', () => {
    const entry = fromTimer();
    entry.adjust({
      startedAt: at('2026-04-01T09:00:00Z'),
      endedAt: at('2026-04-01T10:00:00Z'),
      reason: 'the timer ran on',
      now: at('2026-04-01T11:00:00Z'),
    });
    // Otherwise an edited entry would look like an untouched one.
    expect(entry.source).toBe('manual');
  });

  it('refuses an adjustment with no reason', () => {
    expect(
      fromTimer().adjust({
        startedAt: at('2026-04-01T09:00:00Z'),
        endedAt: at('2026-04-01T10:00:00Z'),
        reason: '',
        now: at('2026-04-01T11:00:00Z'),
      }).ok,
    ).toBe(false);
  });
});

describe('approval and billing (FR-26)', () => {
  function approved() {
    const entry = fromTimer();
    entry.approve('manager-1', at('2026-04-02T06:00:00Z'));
    entry.pullEvents();
    return entry;
  }

  it('only bills time that has been approved', () => {
    const entry = fromTimer();
    expect(entry.includeInStatement('line-1', at('2026-04-02T06:00:00Z')).ok).toBe(false);
    expect(approved().includeInStatement('line-1', at('2026-04-02T06:00:00Z')).ok).toBe(true);
  });

  it('freezes the entry once it is on a statement', () => {
    const entry = approved();
    entry.includeInStatement('line-1', at('2026-04-02T06:00:00Z'));

    // What makes a client statement defensible is that the hours behind it
    // cannot quietly change after it was sent.
    expect(entry.isLocked).toBe(true);
    expect(entry.setBillable(false, at('2026-04-03T06:00:00Z')).ok).toBe(false);
    expect(
      entry.adjust({
        startedAt: at('2026-04-01T09:00:00Z'),
        endedAt: at('2026-04-01T09:30:00Z'),
        reason: 'trimming after the fact',
        now: at('2026-04-03T06:00:00Z'),
      }).ok,
    ).toBe(false);
  });

  it('says why it refused, and which statement holds it', () => {
    const entry = approved();
    entry.includeInStatement('line-1', at('2026-04-02T06:00:00Z'));
    const outcome = entry.setBillable(false, at('2026-04-03T06:00:00Z'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.details.statementLineId).toBe('line-1');
  });

  it('can be released by a manager, and the release is recorded', () => {
    const entry = approved();
    entry.includeInStatement('line-1', at('2026-04-02T06:00:00Z'));
    entry.pullEvents();

    expect(entry.releaseFromStatement('manager-1', at('2026-04-04T06:00:00Z')).ok).toBe(true);
    expect(entry.isLocked).toBe(false);
    expect(entry.pullEvents().map((e) => e.name)).toContain('time.entry.released');

    // And is editable again, which is the point of releasing it.
    expect(entry.setBillable(false, at('2026-04-04T06:00:00Z')).ok).toBe(true);
  });

  it('will not bill the same time twice', () => {
    const entry = approved();
    entry.includeInStatement('line-1', at('2026-04-02T06:00:00Z'));
    expect(entry.includeInStatement('line-2', at('2026-04-02T07:00:00Z')).ok).toBe(false);
  });
});
