import type { BoardTask, TaskBoard, TaskDetail } from '@amc/contracts';
import type { Clock } from '@amc/kernel';
import { type ServiceCode, type TaskState, templateFor } from '../domain/index.js';
import type { CallerLike, TaskRepository, TaskScope } from './ports.js';

/**
 * Names and hours that live outside this module.
 *
 * A task knows its client's id, not the company's name, and it knows nothing
 * at all about recorded time. Both are supplied by the composition root rather
 * than reached for, which is what keeps the modules from depending on each
 * other's tables.
 */
export interface TaskContextReader {
  clientNames(clientIds: readonly string[]): Promise<Map<string, string>>;
  assignees(
    taskIds: readonly string[],
  ): Promise<Map<string, { userId: string; displayName: string; role: string }[]>>;
  recordedSeconds(taskIds: readonly string[]): Promise<Map<string, number>>;
  /** Current documents on a client's file, for satisfying a requirement. */
  documentsFor(
    clientId: string,
  ): Promise<{ id: string; type: string; name: string; expiresOn: Date | null }[]>;
}

/**
 * The columns, in the order the work moves through them.
 *
 * Completed and cancelled are absent on purpose. A board is what is still to
 * be done; finished work belongs in a report, where it can be filtered by date
 * rather than growing without limit down the side of the screen.
 */
const COLUMNS: readonly TaskState[] = [
  'awaiting_documents',
  'ready',
  'in_progress',
  'waiting_for_client',
  'waiting_for_authority',
];

export class ReadTasks {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly context: TaskContextReader,
    private readonly clock: Clock,
  ) {}

  /**
   * Who may see what.
   *
   * `tasks.view.all` is the manager's view. Anyone else sees the work they are
   * assigned to, and someone with neither sees an empty board rather than an
   * error, for the same reason an out-of-scope client reads as not found.
   */
  private scope(caller: CallerLike): TaskScope {
    const held =
      caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions);
    if (held.has('tasks.view.all')) return { kind: 'all' };
    if (held.has('time.record') || held.has('tasks.edit')) {
      return { kind: 'assigned', userId: caller.userId };
    }
    return { kind: 'none' };
  }

  async board(caller: CallerLike): Promise<TaskBoard> {
    const open = await this.tasks.open(this.scope(caller));
    const summaries = await this.decorate(open);

    return {
      columns: COLUMNS.map((state) => ({
        state,
        tasks: summaries.filter((task) => task.state === state),
      })),
    };
  }

  async detail(caller: CallerLike, id: string): Promise<TaskDetail | null> {
    const task = await this.tasks.findById(id, this.scope(caller));
    if (!task) return null;

    const [summary] = await this.decorate([task]);
    if (!summary) return null;

    const template = templateFor(task.service as ServiceCode);
    const documents = await this.context.documentsFor(task.clientId);
    const byId = new Map(documents.map((document) => [document.id, document]));
    const snapshot = task.snapshot();

    return {
      ...summary,
      requirements: task.requirements.map((requirement) => {
        const document = requirement.documentId ? byId.get(requirement.documentId) : undefined;
        return {
          type: requirement.type,
          mandatory: requirement.mandatory,
          documentId: requirement.documentId,
          documentName: document?.name ?? null,
          documentExpiresOn: document?.expiresOn?.toISOString() ?? null,
        };
      }),
      steps: snapshot.steps.map((step) => {
        const named = template?.steps.find((candidate) => candidate.order === step.order);
        return {
          order: step.order,
          titleEn: named?.nameEn ?? `Step ${step.order}`,
          titleAr: named?.nameAr ?? `خطوة ${step.order}`,
          doneAt: step.doneAt?.toISOString() ?? null,
        };
      }),
      allowedTransitions: [...task.allowedNext()],
      availableDocuments: documents.map((document) => ({
        id: document.id,
        type: document.type,
        expiresOn: document.expiresOn?.toISOString() ?? null,
      })),
      startedAt: snapshot.startedAt?.toISOString() ?? null,
      completedAt: snapshot.completedAt?.toISOString() ?? null,
    };
  }

  /** Attaches the names and totals that live in other modules, in one pass. */
  private async decorate(
    tasks: readonly import('../domain/index.js').Task[],
  ): Promise<BoardTask[]> {
    if (tasks.length === 0) return [];

    const now = this.clock.now();
    const ids = tasks.map((task) => task.id);
    const [names, assignees, seconds] = await Promise.all([
      this.context.clientNames([...new Set(tasks.map((task) => task.clientId))]),
      this.context.assignees(ids),
      this.context.recordedSeconds(ids),
    ]);

    return tasks.map((task) => ({
      id: task.id,
      clientId: task.clientId,
      clientName: names.get(task.clientId) ?? '',
      service: task.service,
      periodKey: task.periodKey,
      state: task.status,
      dueAt: task.dueAt?.toISOString() ?? null,
      isOverdue: task.isOverdueAt(now),
      missingDocuments: task.missingDocuments,
      assignees: assignees.get(task.id) ?? [],
      recordedSeconds: seconds.get(task.id) ?? 0,
    }));
  }
}
