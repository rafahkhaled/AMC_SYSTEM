import type { EventCollector } from '@amc/kernel';
import { eq } from 'drizzle-orm';
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
    if (!row) return null;

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
