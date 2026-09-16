import type { Actor, Conflict, EventCollector, Result, UnitOfWork } from '@amc/kernel';
import { Conflict as ConflictError, err, ok } from '@amc/kernel';
import type { Task, TaskState } from '../domain/index.js';
import type { CallerLike, TaskRepository, TaskScope } from './ports.js';

/**
 * Builds a repository bound to the caller's transaction.
 *
 * The change, its audit row and its outbox row are written together or not at
 * all. A task that moved with no record of who moved it is the failure NFR-05
 * exists to prevent, and the only way to guarantee it is to make them the same
 * commit.
 */
export interface TaskRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): TaskRepository;
}

/** Everything that changes a task. */
export class TaskWorkflow {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: TaskRepositoryFactory,
  ) {}

  move(caller: CallerLike, id: string, to: TaskState): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (task, now) =>
      // `start` rather than `moveTo` for the one transition with a gate in
      // front of it, so the missing documents come back in the refusal
      // instead of the screen having to work out why it was refused.
      to === 'in_progress' ? task.start(now) : task.moveTo(to, now),
    );
  }

  completeStep(caller: CallerLike, id: string, order: number): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (task, now) => task.completeStep(order, now));
  }

  attachDocument(
    caller: CallerLike,
    id: string,
    type: string,
    documentId: string,
  ): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (task, now) => task.attachDocument(type, documentId, now));
  }

  detachDocument(caller: CallerLike, id: string, type: string): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (task, now) => task.detachDocument(type, now));
  }

  /**
   * The shape every change shares: find within scope, apply, save.
   *
   * Nothing here calls `context.audit`. Every one of these operations records
   * a domain event, and the unit of work turns each event into an audit row —
   * so an explicit entry as well would put two rows in the log for one change,
   * disagreeing about what to call it. Explicit entries are for what is not a
   * domain event at all: reading a credential, exporting a file.
   *
   * A task outside the caller's scope is not found rather than forbidden,
   * which is the same answer the client screens give and for the same reason.
   */
  private change(
    caller: CallerLike,
    id: string,
    apply: (task: Task, now: Date) => Result<true, Conflict>,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFor(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const task = await repository.findById(id, scopeFor(caller));
      if (!task) return err(new ConflictError('No such task'));

      const outcome = apply(task, new Date());
      if (!outcome.ok) return outcome;

      await repository.save(task);
      return ok(true as const);
    });
  }
}

/**
 * Who may change what.
 *
 * `tasks.edit` alone is not enough to reach another accountant's work: the
 * manager's `tasks.view.all` is what widens it. Anyone else may only move the
 * work they are on, which is the same boundary the board reads through.
 */
/**
 * The person, as the audit log needs to name them.
 *
 * Built here rather than by each controller, because the one field that
 * matters is the one easiest to leave out: an `Actor` with no `label` is
 * perfectly valid and produces a log of changes attributed to nobody.
 */
function actorFor(caller: CallerLike): Actor {
  return {
    userId: caller.userId,
    roles: caller.roles,
    label: caller.displayName,
    ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
  };
}

export function scopeFor(caller: CallerLike): TaskScope {
  const held = caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions);
  if (!held.has('tasks.edit')) return { kind: 'none' };
  return held.has('tasks.view.all') ? { kind: 'all' } : { kind: 'assigned', userId: caller.userId };
}
