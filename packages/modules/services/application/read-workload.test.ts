import type { Workload } from '@amc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ReadWorkload } from './read-workload.js';

const FULL: Workload = {
  people: [
    {
      userId: 'user-a',
      displayName: 'Wael Ajam',
      role: 'manager',
      openTasks: 3,
      overdueTasks: 2,
      dueThisWeek: 1,
      recordedSeconds: 15_900,
    },
  ],
  unassignedTasks: 2,
};

describe('who is on what (FR-13)', () => {
  it('answers for somebody who can move work between people', async () => {
    const read = vi.fn(async () => FULL);
    const workload = await new ReadWorkload({ read }).forCaller({
      userId: 'user-a',
      permissions: new Set(['tasks.assign']),
    });

    expect(workload).toEqual(FULL);
  });

  it('shows nothing to somebody who cannot', async () => {
    /*
     * The point of the screen is to move work. A list of how loaded your
     * colleagues are is no use to somebody who cannot act on it, and is a
     * detail about their working day they have not agreed to share.
     */
    const read = vi.fn(async () => FULL);
    const workload = await new ReadWorkload({ read }).forCaller({
      userId: 'user-b',
      permissions: new Set(['tasks.edit', 'time.record']),
    });

    expect(workload).toEqual({ people: [], unassignedTasks: 0 });
  });

  it('does not even ask the database when the answer would be nothing', async () => {
    // Deciding after the query would still put every colleague's hours into
    // this process's memory for a request that had no right to them.
    const read = vi.fn(async () => FULL);
    await new ReadWorkload({ read }).forCaller({ userId: 'user-b', permissions: new Set() });

    expect(read).not.toHaveBeenCalled();
  });

  it('takes a plain list of permissions as readily as a set', async () => {
    const read = vi.fn(async () => FULL);
    const workload = await new ReadWorkload({ read }).forCaller({
      userId: 'user-a',
      permissions: ['tasks.assign'],
    });

    expect(workload.people).toHaveLength(1);
  });
});
