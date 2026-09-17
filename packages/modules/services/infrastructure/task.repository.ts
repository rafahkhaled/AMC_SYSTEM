import { scopePredicate } from '@amc/database';
import type { EventCollector } from '@amc/kernel';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TaskRepository, TaskScope } from '../application/ports.js';
import {
  type ServiceCode,
  Task,
  type TaskId,
  type TaskState,
  templateFor,
} from '../domain/index.js';
import { taskDocuments, taskSteps, tasks } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const CLOSED: TaskState[] = ['completed', 'cancelled'];

export class DrizzleTaskRepository implements TaskRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  async findById(id: TaskId, scope: TaskScope): Promise<Task | null> {
    if (scope.kind === 'none') return null;
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), this.visibleTo(scope)))
      .limit(1);
    return row ? this.toAggregate(row) : null;
  }

  async forClient(clientId: string, scope: TaskScope): Promise<Task[]> {
    if (scope.kind === 'none') return [];
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, clientId), this.visibleTo(scope)))
      .orderBy(asc(tasks.dueAt));
    return Promise.all(rows.map((row) => this.toAggregate(row)));
  }

  async open(scope: TaskScope, options: { limit?: number } = {}): Promise<Task[]> {
    if (scope.kind === 'none') return [];
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(notInArray(tasks.state, CLOSED), this.visibleTo(scope)))
      // Soonest due first, and tasks with no date last rather than first,
      // which is what NULLS LAST buys over the default ordering.
      .orderBy(sql`${tasks.dueAt} ASC NULLS LAST`)
      .limit(options.limit ?? 100);
    return Promise.all(rows.map((row) => this.toAggregate(row)));
  }

  /**
   * Asked before creating recurring work, so the sweep is safe to run twice.
   * The unique index would refuse the duplicate anyway; asking first means the
   * ordinary case is not an exception being caught.
   */
  async existsForPeriod(clientServiceId: string, periodKey: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.clientServiceId, clientServiceId), eq(tasks.periodKey, periodKey)))
      .limit(1);
    return row !== undefined;
  }

  async save(task: Task): Promise<void> {
    this.collector?.collect(task.pullEvents());
    const state = task.snapshot();

    const row = {
      id: state.id,
      clientServiceId: state.clientServiceId,
      clientId: state.clientId,
      service: state.service,
      periodKey: state.periodKey,
      state: state.state,
      dueAt: state.dueAt,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    };
    await this.db.insert(tasks).values(row).onConflictDoUpdate({ target: tasks.id, set: row });

    for (const requirement of state.requirements) {
      const documentRow = {
        taskId: state.id,
        type: requirement.type,
        mandatory: requirement.mandatory,
        documentId: requirement.documentId,
        attachedAt: requirement.documentId ? new Date() : null,
      };
      await this.db
        .insert(taskDocuments)
        .values(documentRow)
        .onConflictDoUpdate({
          target: [taskDocuments.taskId, taskDocuments.type],
          set: { documentId: documentRow.documentId, attachedAt: documentRow.attachedAt },
        });
    }

    for (const step of state.steps) {
      await this.db
        .insert(taskSteps)
        .values({ taskId: state.id, order: step.order, doneAt: step.doneAt })
        .onConflictDoUpdate({
          target: [taskSteps.taskId, taskSteps.order],
          set: { doneAt: step.doneAt },
        });
    }
  }

  private async toAggregate(row: typeof tasks.$inferSelect): Promise<Task> {
    const [documents, steps] = await Promise.all([
      this.db.select().from(taskDocuments).where(eq(taskDocuments.taskId, row.id)),
      this.db
        .select()
        .from(taskSteps)
        .where(eq(taskSteps.taskId, row.id))
        .orderBy(asc(taskSteps.order)),
    ]);

    const template = templateFor(row.service as ServiceCode);

    return Task.rehydrate({
      id: row.id,
      clientId: row.clientId,
      clientServiceId: row.clientServiceId,
      service: row.service as ServiceCode,
      periodKey: row.periodKey,
      state: row.state as TaskState,
      dueAt: row.dueAt,
      requirements: documents.map((document) => ({
        type: document.type,
        mandatory: document.mandatory,
        documentId: document.documentId,
      })),
      steps:
        steps.length > 0
          ? steps.map((step) => ({ order: step.order, doneAt: step.doneAt }))
          : // A task saved before its steps were written still knows what its
            // template says, rather than appearing to have none.
            template.steps.map((step) => ({ order: step.order, doneAt: null })),
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    });
  }

  /**
   * Scoped through the client, the same way documents are. An accountant sees
   * the work for their own clients and no others.
   */
  private visibleTo(scope: TaskScope) {
    // `undefined` rather than `true`, so an unscoped query carries no clause
    // at all. The predicate itself is shared, because four packages apply the
    // same rule and a scoping rule that drifts lets somebody read a client
    // file that is not theirs.
    if (scope.kind === 'all') return undefined;
    return scopePredicate(scope, sql`${tasks.clientId}`);
  }
}
