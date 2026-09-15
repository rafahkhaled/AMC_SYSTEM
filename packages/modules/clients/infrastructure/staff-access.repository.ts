import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { StaffAccessRepository } from '../application/ports.js';
import { clientStaffAccess } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** Who may see whom. The table the scoped reads join against. */
export class DrizzleStaffAccessRepository implements StaffAccessRepository {
  constructor(private readonly db: Db) {}

  async assign(params: { clientId: string; userId: string; assignedBy: string }): Promise<void> {
    // Assigning twice is not an error. Two managers doing the same thing on
    // the same morning should not produce a failure for either of them.
    await this.db
      .insert(clientStaffAccess)
      .values({
        clientId: params.clientId,
        userId: params.userId,
        assignedBy: params.assignedBy,
      })
      .onConflictDoNothing();
  }

  async revoke(clientId: string, userId: string): Promise<void> {
    await this.db
      .delete(clientStaffAccess)
      .where(and(eq(clientStaffAccess.clientId, clientId), eq(clientStaffAccess.userId, userId)));
  }

  async clientsFor(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ clientId: clientStaffAccess.clientId })
      .from(clientStaffAccess)
      .where(eq(clientStaffAccess.userId, userId));
    return rows.map((row) => row.clientId);
  }

  async staffFor(clientId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: clientStaffAccess.userId })
      .from(clientStaffAccess)
      .where(eq(clientStaffAccess.clientId, clientId));
    return rows.map((row) => row.userId);
  }
}
