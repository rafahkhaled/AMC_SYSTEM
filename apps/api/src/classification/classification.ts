import type {
  Classification,
  ClassificationReport,
  ClassificationRow,
  ClassifiedEntity,
  Salesperson,
  UpdateClassification,
} from '@amc/contracts';
import type { Database } from '@amc/database';
import {
  type CallerLike,
  Conflict,
  NotFound,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  heldBy,
  ok,
} from '@amc/kernel';
import { type SQL, sql } from 'drizzle-orm';

/** Where each kind of record keeps its three fields, and who may change them. */
const TABLES: Record<
  ClassifiedEntity,
  {
    table: SQL;
    branch: boolean;
    performer: boolean;
    permission: string;
    /** How to find the client, for scoping; null where there is none yet. */
    clientColumn: SQL | null;
  }
> = {
  client: {
    table: sql`clients`,
    branch: true,
    performer: true,
    permission: 'clients.edit',
    clientColumn: sql`id`,
  },
  lead: {
    table: sql`leads`,
    branch: true,
    performer: false,
    permission: 'clients.edit',
    clientColumn: null,
  },
  quotation: {
    table: sql`quotations`,
    branch: false,
    performer: true,
    permission: 'billing.approve',
    clientColumn: sql`client_id`,
  },
  project: {
    table: sql`projects`,
    branch: true,
    performer: false,
    permission: 'projects.edit',
    clientColumn: sql`client_id`,
  },
  invoice: {
    table: sql`invoices`,
    branch: false,
    performer: true,
    permission: 'billing.approve',
    clientColumn: sql`client_id`,
  },
};

/**
 * Branch, salesperson and who did the work (the firm's request to classify
 * everything "from registering the client to the end of the process").
 *
 * The values are carried from one step to the next by triggers in the database
 * (migration 0052); this is reading them, changing them on one record, the
 * list of salespeople, and the report that adds them up.
 */
export class ClassificationService {
  constructor(
    private readonly db: Database,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /* ------------------------------------------------------- salespeople -- */

  async salespeople(): Promise<Salesperson[]> {
    const rows = await this.db.execute<{
      id: string;
      name: string;
      user_id: string | null;
      retired: boolean;
    }>(sql`
      SELECT s.id, coalesce(u.display_name, s.name) AS name, s.user_id,
             (s.retired_at IS NOT NULL OR coalesce(u.status, 'active') <> 'active') AS retired
      FROM salespeople s
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY retired, lower(coalesce(u.display_name, s.name))
    `);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      userId: row.user_id,
      retired: row.retired,
    }));
  }

  async addSalesperson(caller: CallerLike, name: string): Promise<Result<string, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: Database }).db;
      const [taken] = await db.execute<{ id: string }>(sql`
        SELECT s.id FROM salespeople s LEFT JOIN users u ON u.id = s.user_id
        WHERE lower(coalesce(u.display_name, s.name)) = lower(${name}) AND s.retired_at IS NULL
      `);
      if (taken) return ok(taken.id);
      const [row] = await db.execute<{ id: string }>(
        sql`INSERT INTO salespeople (name) VALUES (${name}) RETURNING id`,
      );
      const id = row?.id ?? '';
      context.audit({
        action: 'classification.salesperson.added',
        entityType: 'salesperson',
        entityId: id,
        after: { name },
      });
      return ok(id);
    });
  }

  async retireSalesperson(
    caller: CallerLike,
    id: string,
    retired: boolean,
  ): Promise<Result<true, NotFound>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: Database }).db;
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE salespeople SET retired_at = CASE WHEN ${retired} THEN coalesce(retired_at, now()) ELSE NULL END
        WHERE id = ${id} RETURNING id
      `);
      if (rows.length === 0) return err(new NotFound('No such salesperson'));
      context.audit({
        action: retired
          ? 'classification.salesperson.retired'
          : 'classification.salesperson.restored',
        entityType: 'salesperson',
        entityId: id,
      });
      return ok(true as const);
    });
  }

  /* ------------------------------------------------------- one record -- */

  /** Out of scope reads as not there, like every other read. */
  private async reachable(
    caller: CallerLike,
    entity: ClassifiedEntity,
    id: string,
  ): Promise<boolean> {
    const spec = TABLES[entity];
    const [row] = await this.db.execute<{ client_id: string | null }>(sql`
      SELECT ${spec.clientColumn ?? sql`NULL`}::text AS client_id FROM ${spec.table} WHERE id = ${id}
    `);
    if (!row) return false;
    if (!row.client_id || heldBy(caller).has('clients.view.all')) return true;
    const [access] = await this.db.execute<{ one: number }>(sql`
      SELECT 1 AS one FROM client_staff_access WHERE client_id = ${row.client_id} AND user_id = ${caller.userId}
    `);
    return access !== undefined;
  }

  async read(
    caller: CallerLike,
    entity: ClassifiedEntity,
    id: string,
  ): Promise<Classification | null> {
    if (!(await this.reachable(caller, entity, id))) return null;
    const spec = TABLES[entity];
    const performer =
      entity === 'project'
        ? sql`(SELECT a.user_id FROM project_assignments a
               WHERE a.project_id = t.id AND a.role = 'responsible' AND a.unassigned_at IS NULL LIMIT 1)`
        : spec.performer
          ? sql`t.performed_by`
          : sql`NULL`;
    const [row] = await this.db.execute<{
      branch_code: string | null;
      salesperson_id: string | null;
      performed_by: string | null;
    }>(sql`
      SELECT t.branch_code, t.salesperson_id, ${performer}::text AS performed_by
      FROM ${spec.table} t WHERE t.id = ${id}
    `);
    if (!row) return null;
    return {
      branchCode: row.branch_code,
      salespersonId: row.salesperson_id,
      performedBy: row.performed_by,
      branchEditable: spec.branch,
      performerEditable: spec.performer,
    };
  }

  async change(
    caller: CallerLike,
    entity: ClassifiedEntity,
    id: string,
    changes: UpdateClassification,
  ): Promise<Result<true, Conflict | NotFound>> {
    const spec = TABLES[entity];
    if (!heldBy(caller).has(spec.permission as never))
      return err(new NotFound('You do not have access to this'));
    if (!(await this.reachable(caller, entity, id))) return err(new NotFound('Not found'));
    if (changes.branchCode !== undefined && !spec.branch) {
      return err(new Conflict('The branch of this document is set on the document itself'));
    }
    if (changes.performedBy !== undefined && !spec.performer) {
      return err(new Conflict('Who does a job is chosen in its team'));
    }

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: Database }).db;
      if (changes.branchCode) {
        const [branch] = await db.execute<{ one: number }>(
          sql`SELECT 1 AS one FROM branches WHERE code = ${changes.branchCode} AND retired_at IS NULL`,
        );
        if (!branch) return err(new Conflict('That is not one of the firm’s branches'));
      }
      if (changes.salespersonId) {
        const [person] = await db.execute<{ one: number }>(
          sql`SELECT 1 AS one FROM salespeople WHERE id = ${changes.salespersonId} AND retired_at IS NULL`,
        );
        if (!person) return err(new Conflict('That salesperson is not on the list'));
      }
      if (changes.performedBy) {
        const [person] = await db.execute<{ status: string }>(
          sql`SELECT status FROM users WHERE id = ${changes.performedBy}`,
        );
        if (!person) return err(new Conflict('There is no such person'));
        if (person.status !== 'active') return err(new Conflict('This account is suspended'));
      }

      const sets: SQL[] = [];
      if (changes.branchCode !== undefined) sets.push(sql`branch_code = ${changes.branchCode}`);
      if (changes.salespersonId !== undefined)
        sets.push(sql`salesperson_id = ${changes.salespersonId}`);
      if (changes.performedBy !== undefined) sets.push(sql`performed_by = ${changes.performedBy}`);
      if (sets.length === 0) return ok(true as const);

      await db.execute(sql`UPDATE ${spec.table} SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
      context.audit({
        action: `classification.${entity}.changed`,
        entityType: entity,
        entityId: id,
        after: changes as Record<string, unknown>,
      });
      return ok(true as const);
    });
  }

  /* ----------------------------------------------------------- report -- */

  /**
   * The firm's work, added up by branch, by salesperson and by who did it.
   *
   * Clients by when they joined, quotations and jobs by when they were made,
   * invoices (not cancelled) by when they were issued, each within the period.
   */
  async report(from: string, to: string): Promise<ClassificationReport> {
    const between = (column: SQL) =>
      sql`${column} >= ${from}::date AND ${column} < (${to}::date + 1)`;
    const invoiced = sql`
      SELECT i.id, i.branch_code, i.salesperson_id, i.performed_by,
             coalesce((SELECT sum(l.amount_minor) FROM invoice_lines l WHERE l.invoice_id = i.id), 0) AS net
      FROM invoices i
      WHERE i.settlement <> 'cancelled' AND ${between(sql`i.issued_on`)}
    `;

    const group = async (
      dimension: 'branch' | 'salesperson' | 'performer',
    ): Promise<ClassificationRow[]> => {
      const key = {
        branch: {
          client: sql`c.branch_code`,
          quote: sql`q.branch_code`,
          project: sql`p.branch_code`,
          invoice: sql`v.branch_code`,
        },
        salesperson: {
          client: sql`c.salesperson_id`,
          quote: sql`q.salesperson_id`,
          project: sql`p.salesperson_id`,
          invoice: sql`v.salesperson_id`,
        },
        performer: {
          client: sql`c.performed_by`,
          quote: sql`q.performed_by`,
          project: sql`(SELECT a.user_id FROM project_assignments a WHERE a.project_id = p.id AND a.role = 'responsible' AND a.unassigned_at IS NULL LIMIT 1)`,
          invoice: sql`v.performed_by`,
        },
      }[dimension];
      const name = {
        branch: sql`(SELECT name_en FROM branches b WHERE b.code = k.key)`,
        salesperson: sql`(SELECT coalesce(u.display_name, s.name) FROM salespeople s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = k.key)`,
        performer: sql`(SELECT display_name FROM users u WHERE u.id = k.key)`,
      }[dimension];

      const rows = await this.db.execute<{
        key: string | null;
        name: string | null;
        clients: string;
        quotations: string;
        projects: string;
        invoices: string;
        invoiced: string;
      }>(sql`
        WITH
          cl AS (SELECT ${key.client} AS key, count(*) AS n FROM clients c
                 WHERE ${between(sql`c.onboarded_on`)} GROUP BY 1),
          qu AS (SELECT ${key.quote} AS key, count(*) AS n FROM quotations q
                 WHERE ${between(sql`q.created_at`)} GROUP BY 1),
          pr AS (SELECT ${key.project} AS key, count(*) AS n FROM projects p
                 WHERE ${between(sql`p.created_at`)} GROUP BY 1),
          iv AS (SELECT ${key.invoice} AS key, count(*) AS n, sum(v.net) AS net
                 FROM (${invoiced}) v GROUP BY 1),
          k AS (SELECT key FROM cl UNION SELECT key FROM qu UNION SELECT key FROM pr UNION SELECT key FROM iv)
        SELECT k.key, ${name} AS name,
               coalesce(cl.n, 0)::text AS clients, coalesce(qu.n, 0)::text AS quotations,
               coalesce(pr.n, 0)::text AS projects, coalesce(iv.n, 0)::text AS invoices,
               coalesce(iv.net, 0)::text AS invoiced
        FROM k
        LEFT JOIN cl ON cl.key IS NOT DISTINCT FROM k.key
        LEFT JOIN qu ON qu.key IS NOT DISTINCT FROM k.key
        LEFT JOIN pr ON pr.key IS NOT DISTINCT FROM k.key
        LEFT JOIN iv ON iv.key IS NOT DISTINCT FROM k.key
        ORDER BY coalesce(iv.net, 0) DESC, k.key NULLS LAST
      `);
      return rows.map((row) => ({
        key: row.key,
        name: row.name,
        clients: Number(row.clients),
        quotations: Number(row.quotations),
        projects: Number(row.projects),
        invoices: Number(row.invoices),
        invoicedMinor: Number(row.invoiced),
      }));
    };

    return {
      from,
      to,
      byBranch: await group('branch'),
      bySalesperson: await group('salesperson'),
      byPerformer: await group('performer'),
    };
  }
}
