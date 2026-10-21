import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PasswordResetRepository } from '../application/ports.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: Db) {}

  async issue(params: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
    now: Date;
  }): Promise<void> {
    // Asking again voids the earlier link, so only the newest email works.
    await this.db.execute(sql`
      UPDATE password_resets SET used_at = ${params.now.toISOString()}
      WHERE user_id = ${params.userId} AND used_at IS NULL
    `);
    await this.db.execute(sql`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at, requested_ip, created_at)
      VALUES (${params.id}, ${params.userId}, ${params.tokenHash},
              ${params.expiresAt.toISOString()}, ${params.requestedIp},
              ${params.now.toISOString()})
    `);
  }

  async findLive(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null> {
    const rows = await this.db.execute<{ id: string; user_id: string }>(sql`
      SELECT id, user_id FROM password_resets
      WHERE token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > ${now.toISOString()}
      LIMIT 1
    `);
    const row = rows[0];
    return row ? { id: row.id, userId: row.user_id } : null;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE password_resets SET used_at = ${at.toISOString()} WHERE id = ${id}
    `);
  }
}
