import type { CampaignView, CreateCampaignRequest, UpdateCampaignRequest } from '@amc/contracts';
import { type Database, referenceLookup } from '@amc/database';
import type { UnitOfWork } from '@amc/kernel';
import { Conflict, type IdGenerator, type Result, actorFrom, err, ok } from '@amc/kernel';
import { sql } from 'drizzle-orm';

type Row = {
  id: string;
  name: string;
  type_code: string;
  starts_on: string;
  duration_days: number | null;
  ends_on: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  notes: string | null;
  status: string;
  cost_minor: string | number;
  currency: string;
  leads: string | number;
  clients: string | number;
};

const day = (value: string): string => new Date(value).toISOString().slice(0, 10);

function toView(row: Row): CampaignView {
  return {
    id: row.id,
    name: row.name,
    typeCode: row.type_code,
    startsOn: day(row.starts_on),
    durationDays: row.duration_days,
    endsOn: row.ends_on ? day(row.ends_on) : null,
    salespersonId: row.salesperson_id,
    salespersonName: row.salesperson_name,
    notes: row.notes,
    status: row.status as CampaignView['status'],
    costMinor: Number(row.cost_minor),
    currency: row.currency,
    leads: Number(row.leads),
    clients: Number(row.clients),
  };
}

/**
 * Advertising campaigns.
 *
 * Reference data with a cost on it and no behaviour beyond that, so it lives
 * beside the other adapters rather than becoming a module. It is still audited:
 * what was spent, and who changed the figure afterwards, is what somebody asks
 * when the numbers are compared with the invoices.
 */
export class Campaigns {
  private readonly lists: ReturnType<typeof referenceLookup>;

  constructor(
    private readonly db: Database,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
  ) {
    this.lists = referenceLookup(db);
  }

  /** Newest first, with what each has brought in. */
  async all(): Promise<CampaignView[]> {
    const rows = await this.db.execute<Row>(sql`
      SELECT c.*, u.display_name AS salesperson_name,
             (c.starts_on + (c.duration_days - 1))::text AS ends_on,
             c.starts_on::text AS starts_on,
             count(l.id)::text AS leads,
             count(l.converted_client_id)::text AS clients
      FROM campaigns c
      LEFT JOIN users u ON u.id = c.salesperson_id
      LEFT JOIN leads l ON l.campaign_id = c.id
      GROUP BY c.id, u.display_name
      ORDER BY c.starts_on DESC, c.created_at DESC
    `);
    return rows.map(toView);
  }

  async find(id: string): Promise<CampaignView | null> {
    return (await this.all()).find((campaign) => campaign.id === id) ?? null;
  }

  async exists(id: string): Promise<boolean> {
    const rows = await this.db.execute<{ one: number }>(
      sql`SELECT 1 AS one FROM campaigns WHERE id = ${id}`,
    );
    return rows.length > 0;
  }

  private async refusal(
    typeCode: string | undefined,
    salespersonId: string | null | undefined,
  ): Promise<Conflict | null> {
    if (typeCode !== undefined && !(await this.lists.isLive('campaign_type', typeCode))) {
      return new Conflict('That is not a type of campaign the firm uses');
    }
    if (salespersonId) {
      const rows = await this.db.execute<{ one: number }>(
        sql`SELECT 1 AS one FROM users WHERE id = ${salespersonId}`,
      );
      if (rows.length === 0) return new Conflict('That salesperson does not exist');
    }
    return null;
  }

  async add(
    caller: Parameters<typeof actorFrom>[0],
    input: CreateCampaignRequest,
  ): Promise<Result<string, Conflict>> {
    const refused = await this.refusal(input.typeCode, input.salespersonId);
    if (refused) return err(refused);

    const id = this.ids.next();
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const transaction = (context as unknown as { db: Database }).db;
      await transaction.execute(sql`
        INSERT INTO campaigns
          (id, name, type_code, starts_on, duration_days, salesperson_id, notes, status, cost_minor)
        VALUES (${id}, ${input.name}, ${input.typeCode}, ${input.startsOn}::date,
                ${input.durationDays ?? null}, ${input.salespersonId ?? null},
                ${input.notes ?? null}, ${input.status}, ${input.costMinor})
      `);
      context.audit({
        action: 'campaigns.campaign.added',
        entityType: 'campaign',
        entityId: id,
        after: {
          name: input.name,
          typeCode: input.typeCode,
          startsOn: input.startsOn,
          status: input.status,
          costMinor: input.costMinor,
        },
      });
      return ok(id);
    });
  }

  async change(
    caller: Parameters<typeof actorFrom>[0],
    id: string,
    changes: UpdateCampaignRequest,
  ): Promise<Result<true, Conflict>> {
    const refused = await this.refusal(changes.typeCode, changes.salespersonId);
    if (refused) return err(refused);

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const transaction = (context as unknown as { db: Database }).db;
      const [current] = await transaction.execute<Row>(sql`
        SELECT c.*, c.starts_on::text AS starts_on, NULL::text AS ends_on,
               NULL::text AS salesperson_name, '0' AS leads, '0' AS clients
        FROM campaigns c WHERE c.id = ${id} LIMIT 1
      `);
      if (!current) return err(new Conflict('No such campaign'));
      const before = toView(current);

      // Presence, not truthiness: a duration or salesperson of null clears it.
      const has = <K extends keyof UpdateCampaignRequest>(key: K) => changes[key] !== undefined;
      await transaction.execute(sql`
        UPDATE campaigns SET
          name = ${changes.name ?? before.name},
          type_code = ${changes.typeCode ?? before.typeCode},
          starts_on = ${changes.startsOn ?? before.startsOn}::date,
          duration_days = ${has('durationDays') ? (changes.durationDays ?? null) : before.durationDays},
          salesperson_id = ${has('salespersonId') ? (changes.salespersonId ?? null) : before.salespersonId},
          notes = ${has('notes') ? (changes.notes ?? null) : before.notes},
          status = ${changes.status ?? before.status},
          cost_minor = ${changes.costMinor ?? before.costMinor}
        WHERE id = ${id}
      `);
      context.audit({
        action: 'campaigns.campaign.changed',
        entityType: 'campaign',
        entityId: id,
        before: {
          name: before.name,
          typeCode: before.typeCode,
          status: before.status,
          costMinor: before.costMinor,
        },
        after: changes as Record<string, unknown>,
      });
      return ok(true as const);
    });
  }
}
