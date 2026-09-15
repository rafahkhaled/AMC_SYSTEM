import { Conflict, type Result, err, ok } from '@amc/kernel';

export type AssignmentId = string;
export type AssignmentRole = 'responsible' | 'collaborator';

export interface Assignment {
  readonly id: AssignmentId;
  readonly taskId: string;
  readonly userId: string;
  readonly role: AssignmentRole;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  readonly unassignedAt: Date | null;
}

/**
 * Who is on a task, and who was (FR-13).
 *
 * Held as history rather than a field, because a time entry points at an
 * assignment. If a task simply carried an assignee, reassigning it in April
 * would silently re-attribute March's hours to whoever holds it now, and a
 * statement broken down by staff member would quietly change after the client
 * had already paid it.
 */
export class TaskAssignments {
  private constructor(private readonly entries: readonly Assignment[]) {}

  static empty(): TaskAssignments {
    return new TaskAssignments([]);
  }

  static from(entries: readonly Assignment[]): TaskAssignments {
    return new TaskAssignments(
      [...entries].sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime()),
    );
  }

  get all(): readonly Assignment[] {
    return this.entries;
  }

  get live(): readonly Assignment[] {
    return this.entries.filter((entry) => entry.unassignedAt === null);
  }

  /** The one person accountable, if anyone is. */
  get responsible(): Assignment | null {
    return this.live.find((entry) => entry.role === 'responsible') ?? null;
  }

  /** Who held this task at a given moment, which is what a timesheet needs. */
  liveAt(moment: Date): readonly Assignment[] {
    return this.entries.filter(
      (entry) =>
        entry.assignedAt.getTime() <= moment.getTime() &&
        (entry.unassignedAt === null || entry.unassignedAt.getTime() > moment.getTime()),
    );
  }

  assign(entry: Assignment): Result<TaskAssignments, Conflict> {
    if (this.live.some((existing) => existing.userId === entry.userId)) {
      return err(new Conflict('That person already has this task'));
    }

    // Handing over replaces the responsible person rather than adding a second.
    // Two people accountable is nobody accountable.
    const entries =
      entry.role === 'responsible' && this.responsible
        ? this.entries.map((existing) =>
            existing.id === this.responsible?.id
              ? { ...existing, unassignedAt: entry.assignedAt }
              : existing,
          )
        : this.entries;

    return ok(TaskAssignments.from([...entries, entry]));
  }

  unassign(userId: string, at: Date): Result<TaskAssignments, Conflict> {
    const current = this.live.find((entry) => entry.userId === userId);
    if (!current) return err(new Conflict('That person does not have this task'));

    return ok(
      TaskAssignments.from(
        this.entries.map((entry) =>
          entry.id === current.id ? { ...entry, unassignedAt: at } : entry,
        ),
      ),
    );
  }

  /**
   * The assignment a time entry should be booked against.
   *
   * Null means nobody is on this task, and time cannot be recorded against it
   * at all. That is deliberate: FR-20 says no unattributed time exists, and an
   * entry with no assignment would be exactly that.
   */
  assignmentFor(userId: string): Assignment | null {
    return this.live.find((entry) => entry.userId === userId) ?? null;
  }
}
