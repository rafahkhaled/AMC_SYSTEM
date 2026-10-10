import { scopePredicate } from '@amc/database';
import type { EventCollector } from '@amc/kernel';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ProjectRepository, ProjectScope } from '../application/ports.js';
import {
  Project,
  type ProjectId,
  type ProjectState,
  type ServiceCode,
  templateFor,
} from '../domain/index.js';
import { projectDocuments, projects, tasks } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const CLOSED: ProjectState[] = ['completed', 'cancelled'];

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  async findById(id: ProjectId, scope: ProjectScope): Promise<Project | null> {
    if (scope.kind === 'none') return null;
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), this.visibleTo(scope)))
      .limit(1);
    return row ? this.toAggregate(row) : null;
  }

  async forClient(clientId: string, scope: ProjectScope): Promise<Project[]> {
    if (scope.kind === 'none') return [];
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, clientId), this.visibleTo(scope)))
      .orderBy(asc(projects.dueAt));
    return Promise.all(rows.map((row) => this.toAggregate(row)));
  }

  async open(scope: ProjectScope, options: { limit?: number } = {}): Promise<Project[]> {
    if (scope.kind === 'none') return [];
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(notInArray(projects.state, CLOSED), this.visibleTo(scope)))
      // Soonest due first, and projects with no date last rather than first,
      // which is what NULLS LAST buys over the default ordering.
      .orderBy(sql`${projects.dueAt} ASC NULLS LAST`)
      .limit(options.limit ?? 100);
    return Promise.all(rows.map((row) => this.toAggregate(row)));
  }

  /**
   * Asked before creating recurring work, so the sweep is safe to run twice.
   * The unique index would refuse the duplicate anyway; asking first means the
   * ordinary case is not an exception being caught.
   */
  async existsForPeriod(clientServiceId: string, periodKey: string): Promise<boolean> {
    /*
     * Across every engagement the client has had for this service, not only the
     * one named. Ending a subscription and starting it again makes a new row,
     * and a project opened under the old one for September is still
     * September's project: asked per row, the sweep would open it a second
     * time under the new one and somebody would file the same return twice.
     * The unique index is per row, so this question is the only thing that
     * holds across them.
     */
    const rows = await this.db.execute<{ one: number }>(sql`
      SELECT 1 AS one
      FROM projects p
      JOIN client_services cs ON cs.id = p.client_service_id
      WHERE p.period_key = ${periodKey}
        AND (cs.client_id, cs.service) = (
          SELECT client_id, service FROM client_services WHERE id = ${clientServiceId}
        )
      LIMIT 1
    `);
    return rows.length > 0;
  }

  async save(project: Project): Promise<void> {
    this.collector?.collect(project.pullEvents());
    const state = project.snapshot();

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
    await this.db
      .insert(projects)
      .values(row)
      .onConflictDoUpdate({ target: projects.id, set: row });

    for (const requirement of state.requirements) {
      const documentRow = {
        projectId: state.id,
        type: requirement.type,
        mandatory: requirement.mandatory,
        documentId: requirement.documentId,
        attachedAt: requirement.documentId ? new Date() : null,
      };
      await this.db
        .insert(projectDocuments)
        .values(documentRow)
        .onConflictDoUpdate({
          target: [projectDocuments.projectId, projectDocuments.type],
          set: { documentId: documentRow.documentId, attachedAt: documentRow.attachedAt },
        });
    }

    for (const task of state.tasks) {
      await this.db
        .insert(tasks)
        .values({
          projectId: state.id,
          order: task.order,
          dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : null,
          doneAt: task.doneAt,
        })
        .onConflictDoUpdate({
          target: [tasks.projectId, tasks.order],
          set: {
            doneAt: task.doneAt,
            dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : null,
          },
        });
    }
  }

  private async toAggregate(row: typeof projects.$inferSelect): Promise<Project> {
    // `taskRows`, not `tasks`: the table itself is imported under that name,
    // and a local of the same name shadows it in its own initialiser.
    const [documents, taskRows] = await Promise.all([
      this.db.select().from(projectDocuments).where(eq(projectDocuments.projectId, row.id)),
      this.db.select().from(tasks).where(eq(tasks.projectId, row.id)).orderBy(asc(tasks.order)),
    ]);

    // Only the eleven in code can be missing their task rows: a project for a
    // service the firm added always has them, because starting it writes them.
    const template = templateFor(row.service as ServiceCode);

    return Project.rehydrate({
      id: row.id,
      clientId: row.clientId,
      clientServiceId: row.clientServiceId,
      service: row.service as ServiceCode,
      periodKey: row.periodKey,
      state: row.state as ProjectState,
      dueAt: row.dueAt,
      requirements: documents.map((document) => ({
        type: document.type,
        mandatory: document.mandatory,
        documentId: document.documentId,
      })),
      tasks:
        taskRows.length > 0
          ? taskRows.map((task) => ({
              order: task.order,
              dueOn: task.dueOn ? new Date(task.dueOn) : null,
              doneAt: task.doneAt,
            }))
          : // A project saved before its tasks were written still knows what its
            // template says, rather than appearing to have none.
            (template?.tasks ?? []).map((task) => ({
              order: task.order,
              dueOn: null,
              doneAt: null,
            })),
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    });
  }

  /**
   * Scoped through the client, the same way documents are. An accountant sees
   * the work for their own clients and no others.
   */
  private visibleTo(scope: ProjectScope) {
    // `undefined` rather than `true`, so an unscoped query carries no clause
    // at all. The predicate itself is shared, because four packages apply the
    // same rule and a scoping rule that drifts lets somebody read a client
    // file that is not theirs.
    if (scope.kind === 'all') return undefined;
    return scopePredicate(scope, sql`${projects.clientId}`);
  }
}
