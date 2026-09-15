import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ClientService, ClientServiceRepository } from '../application/ports.js';
import type { ServiceCode } from '../domain/index.js';
import { clientServices } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const asColumn = (value: Date) => value.toISOString().slice(0, 10);

export class DrizzleClientServiceRepository implements ClientServiceRepository {
  constructor(private readonly db: Db) {}

  async activeFor(clientId: string): Promise<ClientService[]> {
    const rows = await this.db
      .select()
      .from(clientServices)
      .where(and(eq(clientServices.clientId, clientId), isNull(clientServices.activeTo)));
    return rows.map(toSubscription);
  }

  /** Every live subscription to one service, for the recurrence sweep. */
  async allActive(service: ServiceCode): Promise<ClientService[]> {
    const rows = await this.db
      .select()
      .from(clientServices)
      .where(and(eq(clientServices.service, service), isNull(clientServices.activeTo)));
    return rows.map(toSubscription);
  }

  async subscribe(params: {
    id: string;
    clientId: string;
    service: ServiceCode;
    activeFrom: Date;
  }): Promise<ClientService> {
    const [row] = await this.db
      .insert(clientServices)
      .values({
        id: params.id,
        clientId: params.clientId,
        service: params.service,
        activeFrom: asColumn(params.activeFrom),
      })
      .returning();

    if (!row) throw new Error('The subscription was not written');
    return toSubscription(row);
  }

  /**
   * Ends a subscription rather than deleting it. The tasks it produced still
   * exist, and the hours booked against them still have to be explainable.
   */
  async end(id: string, on: Date): Promise<void> {
    await this.db
      .update(clientServices)
      .set({ activeTo: asColumn(on) })
      .where(eq(clientServices.id, id));
  }
}

function toSubscription(row: typeof clientServices.$inferSelect): ClientService {
  return {
    id: row.id,
    clientId: row.clientId,
    service: row.service as ServiceCode,
    activeFrom: asDate(row.activeFrom),
    activeTo: row.activeTo ? asDate(row.activeTo) : null,
  };
}
