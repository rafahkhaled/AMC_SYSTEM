import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CredentialRepository } from '../application/ports.js';
import type { ClientScope } from '../domain/access.js';
import { ClientCredential, type CredentialKind } from '../domain/credential.js';
import { clientCredentials } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzleCredentialRepository implements CredentialRepository {
  constructor(private readonly db: Db) {}

  async currentFor(clientId: string, scope: ClientScope): Promise<ClientCredential[]> {
    if (!(await this.reachable(clientId, scope))) return [];

    const rows = await this.db
      .select()
      .from(clientCredentials)
      .where(and(eq(clientCredentials.clientId, clientId), isNull(clientCredentials.retiredAt)));

    return rows.map((row) => this.toAggregate(row));
  }

  async findById(id: string, scope: ClientScope): Promise<ClientCredential | null> {
    const [row] = await this.db
      .select()
      .from(clientCredentials)
      .where(eq(clientCredentials.id, id))
      .limit(1);

    if (!row) return null;
    // Out of scope and non-existent give the same answer, so a credential id
    // cannot be used to learn which clients a firm has.
    return (await this.reachable(row.clientId, scope)) ? this.toAggregate(row) : null;
  }

  async save(credential: ClientCredential): Promise<void> {
    const state = credential.snapshot();
    const row = {
      id: state.id,
      clientId: state.clientId,
      kind: state.kind,
      username: state.username,
      secretSealed: state.secretSealed,
      note: state.note,
      retiredAt: state.retiredAt,
      retiredBy: state.retiredBy,
      createdBy: state.createdBy,
    };
    await this.db
      .insert(clientCredentials)
      .values(row)
      .onConflictDoUpdate({ target: clientCredentials.id, set: row });
  }

  /**
   * Whether this caller may reach this client at all.
   *
   * Decided here rather than above, so a caller cannot skip it. Parameterised
   * rather than interpolated: a client id is a value, and building SQL by
   * concatenation is how a value becomes a statement.
   */
  private async reachable(clientId: string, scope: ClientScope): Promise<boolean> {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'none') return false;

    const rows = await this.db.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM client_staff_access
      WHERE client_id = ${clientId} AND user_id = ${scope.userId}
      LIMIT 1
    `);
    return rows.length > 0;
  }

  private toAggregate(row: typeof clientCredentials.$inferSelect): ClientCredential {
    return ClientCredential.rehydrate({
      id: row.id,
      clientId: row.clientId,
      kind: row.kind as CredentialKind,
      username: row.username,
      secretSealed: row.secretSealed,
      note: row.note,
      retiredAt: row.retiredAt,
      retiredBy: row.retiredBy,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
  }
}
