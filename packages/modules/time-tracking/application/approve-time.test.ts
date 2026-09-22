import { describe, expect, it } from 'vitest';
import { TimeEntry, type TimeEntryId } from '../domain/index.js';
import { ApproveTime } from './approve-time.js';
import type { TimeEntryRepository } from './ports.js';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const clock = { now: () => NOW };

function entry(id: string): TimeEntry {
  const made = TimeEntry.fromTimer({
    id: id as TimeEntryId,
    assignmentId: 'a-1',
    startedAt: new Date('2026-09-30T06:00:00.000Z'),
    endedAt: new Date('2026-09-30T08:00:00.000Z'),
  });
  if (!made.ok) throw made.error;
  return made.value;
}

/** Only what this use case touches; the rest throws if anybody reaches for it. */
class Entries implements TimeEntryRepository {
  readonly saved: TimeEntry[] = [];
  constructor(private readonly known: Map<string, TimeEntry>) {}

  async findById(id: string): Promise<TimeEntry | null> {
    return this.known.get(id) ?? null;
  }
  async save(entry: TimeEntry): Promise<void> {
    this.saved.push(entry);
  }
  forAssignment = (): never => {
    throw new Error('not used');
  };
  forUserBetween = (): never => {
    throw new Error('not used');
  };
  timesheet = (): never => {
    throw new Error('not used');
  };
  awaitingReview = (): never => {
    throw new Error('not used');
  };
  unbilledForClient = (): never => {
    throw new Error('not used');
  };
}

function harness(entries: TimeEntry[]) {
  const repository = new Entries(new Map(entries.map((one) => [one.id, one])));
  return { repository, approve: new ApproveTime(repository, clock) };
}

describe('approving recorded time', () => {
  it('approves what was chosen, and saves it', async () => {
    const one = entry('e-1');
    const { approve, repository } = harness([one]);

    const result = await approve.execute('u-boss', ['e-1']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.approved).toEqual(['e-1']);

    // Approval is the gate between a timesheet and a bill: unbilled work is
    // read by `approved_at`, so this is the only thing that opens it.
    expect(repository.saved).toHaveLength(1);
    expect(one.snapshot().approvedAt).toEqual(NOW);
    expect(one.snapshot().approvedBy).toBe('u-boss');
  });

  it('records who approved it, on the entry and as an event', async () => {
    const one = entry('e-1');
    const { approve } = harness([one]);
    await approve.execute('u-boss', ['e-1']);

    const approved = one.pullEvents().find((event) => event.name === 'time.entry.approved');
    expect(approved?.payload).toMatchObject({ entryId: 'e-1', approvedBy: 'u-boss' });
  });

  it('approves the rest when one of them cannot be', async () => {
    const good = entry('e-1');
    const { approve } = harness([good]);

    const result = await approve.execute('u-boss', ['e-1', 'e-missing']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /*
     * Not all or nothing. A week's approval where one row is wrong should
     * approve the other nine and say which one it could not, rather than
     * refuse the lot and leave somebody to find out why.
     */
    expect(result.value.approved).toEqual(['e-1']);
    expect(result.value.refused).toEqual([
      { id: 'e-missing', because: 'That time entry is not there' },
    ]);
  });

  it('will not approve time that is already on a statement', async () => {
    const one = entry('e-1');
    one.approve('u-boss', NOW);
    one.includeInStatement('sl-1', NOW);
    const { approve } = harness([one]);

    const result = await approve.execute('u-boss', ['e-1']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.approved).toEqual([]);
      expect(result.value.refused[0]?.because).toContain('already on a statement');
    }
  });

  it('refuses an empty selection rather than reporting nothing done', async () => {
    const { approve } = harness([]);
    const result = await approve.execute('u-boss', []);
    expect(result.ok).toBe(false);
  });
});
