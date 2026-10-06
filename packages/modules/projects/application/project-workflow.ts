import {
  Conflict,
  Conflict as ConflictError,
  type EventCollector,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  heldBy,
  ok,
} from '@amc/kernel';
import type { Project, ProjectState } from '../domain/index.js';
import type { CallerLike, ProjectRepository, ProjectScope } from './ports.js';

/**
 * Builds a repository bound to the caller's transaction.
 *
 * The change, its audit row and its outbox row are written together or not at
 * all. A project that moved with no record of who moved it is the failure NFR-05
 * exists to prevent, and the only way to guarantee it is to make them the same
 * commit.
 */
export interface ProjectRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): ProjectRepository;
}

/** Everything that changes a project. */
export class ProjectWorkflow {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: ProjectRepositoryFactory,
  ) {}

  /** When a step should be finished (FR-11). Null clears it. */
  setTaskDue(
    caller: CallerLike,
    id: string,
    order: number,
    dueOn: Date | null,
  ): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (project, now) => project.setTaskDueOn(order, dueOn, now));
  }

  move(
    caller: CallerLike,
    id: string,
    to: ProjectState,
    reason?: string,
  ): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (project, now) =>
      // `start` rather than `moveTo` for the one transition with a gate in
      // front of it, so the missing documents come back in the refusal
      // instead of the screen having to work out why it was refused.
      to === 'in_progress' ? project.start(now) : project.moveTo(to, now, reason),
    );
  }

  completeTask(caller: CallerLike, id: string, order: number): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (project, now) => project.completeTask(order, now));
  }

  attachDocument(
    caller: CallerLike,
    id: string,
    type: string,
    documentId: string,
  ): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (project, now) => project.attachDocument(type, documentId, now));
  }

  detachDocument(caller: CallerLike, id: string, type: string): Promise<Result<true, Conflict>> {
    return this.change(caller, id, (project, now) => project.detachDocument(type, now));
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
   * A project outside the caller's scope is not found rather than forbidden,
   * which is the same answer the client screens give and for the same reason.
   */
  private change(
    caller: CallerLike,
    id: string,
    apply: (project: Project, now: Date) => Result<true, Conflict>,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const project = await repository.findById(id, scopeFor(caller));
      if (!project) return err(new ConflictError('No such project'));

      const outcome = apply(project, new Date());
      if (!outcome.ok) return outcome;

      await repository.save(project);
      return ok(true as const);
    });
  }
}

/**
 * Who may change what.
 *
 * `projects.edit` alone is not enough to reach another accountant's work: the
 * manager's `projects.view.all` is what widens it. Anyone else may only move the
 * work they are on, which is the same boundary the board reads through.
 */

export function scopeFor(caller: CallerLike): ProjectScope {
  const held = heldBy(caller);
  if (!held.has('projects.edit')) return { kind: 'none' };
  return held.has('projects.view.all')
    ? { kind: 'all' }
    : { kind: 'assigned', userId: caller.userId };
}
