import type { Database } from '@amc/database';
import {
  Conflict,
  type IdGenerator,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  ok,
} from '@amc/kernel';
import { sql } from 'drizzle-orm';

/**
 * Who is on a job (feedback: "after creating the project we cannot add the
 * responsible person").
 *
 * There was no way to put somebody on a job except by them starting a timer on
 * it, which only made them a collaborator. Here a manager names the one person
 * responsible and any helpers. Lives in the composition root because it writes
 * two modules' tables: the assignment is the projects module's, and the access
 * to the client is the clients module's — somebody put on a job has to be able
 * to open the client it is for, or they are given work they cannot see.
 */
export class ProjectAssignments {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
  ) {}

  async assign(
    caller: Parameters<typeof actorFrom>[0],
    projectId: string,
    userId: string,
    role: 'responsible' | 'collaborator',
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: Database }).db;
      const [project] = await db.execute<{ client_id: string }>(
        sql`SELECT client_id FROM projects WHERE id = ${projectId}`,
      );
      if (!project) return err(new Conflict('No such project'));
      const [person] = await db.execute<{ status: string }>(
        sql`SELECT status FROM users WHERE id = ${userId}`,
      );
      if (!person) return err(new Conflict('There is no such person'));
      if (person.status !== 'active') return err(new Conflict('This account is suspended'));

      const now = new Date().toISOString();
      // One responsible at a time: naming a new one moves the old one to helper.
      if (role === 'responsible') {
        await db.execute(sql`
          UPDATE project_assignments SET role = 'collaborator'
          WHERE project_id = ${projectId} AND role = 'responsible'
            AND unassigned_at IS NULL AND user_id <> ${userId}
        `);
      }
      const [live] = await db.execute<{ id: string; role: string }>(sql`
        SELECT id, role FROM project_assignments
        WHERE project_id = ${projectId} AND user_id = ${userId} AND unassigned_at IS NULL
      `);
      if (live) {
        if (live.role !== role) {
          await db.execute(
            sql`UPDATE project_assignments SET role = ${role} WHERE id = ${live.id}`,
          );
        }
      } else {
        await db.execute(sql`
          INSERT INTO project_assignments (id, project_id, user_id, role, assigned_by, assigned_at)
          VALUES (${this.ids.next()}, ${projectId}, ${userId}, ${role}, ${caller.userId}, ${now})
        `);
      }
      await db.execute(sql`
        INSERT INTO client_staff_access (client_id, user_id, assigned_by)
        VALUES (${project.client_id}, ${userId}, ${caller.userId})
        ON CONFLICT DO NOTHING
      `);
      context.audit({
        action: 'projects.project.assigned',
        entityType: 'project',
        entityId: projectId,
        after: { userId, role },
      });
      return ok(true as const);
    });
  }

  /** Taking somebody off a job. Their recorded time stays theirs. */
  async unassign(
    caller: Parameters<typeof actorFrom>[0],
    projectId: string,
    userId: string,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: Database }).db;
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE project_assignments SET unassigned_at = now()
        WHERE project_id = ${projectId} AND user_id = ${userId} AND unassigned_at IS NULL
        RETURNING id
      `);
      if (rows.length === 0) return err(new Conflict('That person does not have this project'));
      context.audit({
        action: 'projects.project.unassigned',
        entityType: 'project',
        entityId: projectId,
        before: { userId },
      });
      return ok(true as const);
    });
  }
}
