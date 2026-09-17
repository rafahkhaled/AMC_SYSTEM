import type { EventCollector } from '@amc/kernel';
import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LeadRepository } from '../application/ports.js';
import { Lead, type LeadId, type LeadSource, type LeadStatus } from '../domain/index.js';
import { leads } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Leads are not scoped. An enquiry belongs to the firm rather than to a
 * client, and nobody is assigned to it until it becomes one.
 */
export class DrizzleLeadRepository implements LeadRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  async findById(id: LeadId): Promise<Lead | null> {
    const [row] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return row ? this.toAggregate(row) : null;
  }

  /** One mapping for both reads, so a column added to one is added to both. */
  private toAggregate(row: typeof leads.$inferSelect): Lead {
    return Lead.rehydrate({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      source: row.source as LeadSource,
      sourceDetail: row.sourceDetail,
      requestedService: row.requestedService,
      status: row.status as LeadStatus,
      convertedClientId: row.convertedClientId,
      receivedAt: row.receivedAt,
      notes: row.notes,
    });
  }

  /**
   * Every enquiry, newest first.
   *
   * Unscoped, deliberately. A lead is not yet anybody's client, so there is
   * no assignment to scope by — and hiding new enquiries from the people who
   * would follow them up is how a lead goes cold.
   */
  async all(options: { limit?: number } = {}): Promise<Lead[]> {
    const rows = await this.db
      .select()
      .from(leads)
      .orderBy(desc(leads.receivedAt))
      .limit(options.limit ?? 200);

    return rows.map((row) => this.toAggregate(row));
  }

  async save(lead: Lead): Promise<void> {
    this.collector?.collect(lead.pullEvents());
    const state = lead.snapshot();

    const row = {
      id: state.id,
      name: state.name,
      phone: state.phone,
      email: state.email,
      source: state.source,
      sourceDetail: state.sourceDetail,
      requestedService: state.requestedService,
      status: state.status,
      convertedClientId: state.convertedClientId,
      receivedAt: state.receivedAt,
      notes: state.notes,
    };

    await this.db.insert(leads).values(row).onConflictDoUpdate({ target: leads.id, set: row });
  }
}
