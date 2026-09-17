import type { Workload } from '@amc/contracts';
import type { CallerLike } from './ports.js';

/**
 * Who is on what, from the modules that own those facts.
 *
 * Assignments belong to this module, names to identity and recorded time to
 * time tracking. The join lives in the composition root, which is the only
 * place allowed to know about all three.
 */
export interface WorkloadReader {
  read(): Promise<Workload>;
}

/**
 * What is on each person's desk (FR-13).
 *
 * A manager's view, and only a manager's: the point of it is to move work
 * between people, and somebody who cannot do that has no use for a list of
 * how loaded their colleagues are. An accountant sees their own board
 * instead.
 */
export class ReadWorkload {
  constructor(private readonly reader: WorkloadReader) {}

  /**
   * Takes only what it uses.
   *
   * This is a permission check and nothing else — it has no audit row to
   * write and no scope to derive, so asking for a display name would be
   * asking a caller for something it does not need.
   */
  async forCaller(caller: Pick<CallerLike, 'userId' | 'permissions'>): Promise<Workload> {
    const held =
      caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions);
    if (!held.has('tasks.assign')) return { people: [], unassignedTasks: 0 };

    return this.reader.read();
  }
}
