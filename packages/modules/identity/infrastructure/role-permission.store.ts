import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RolePermissionStore } from '../application/ports.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;
type Chosen = Partial<Record<string, readonly string[]>>;

/**
 * The firm's choices, kept in memory between requests.
 *
 * Every request asks what the caller's roles allow, so a query each time would
 * be a query on every click. Thirty seconds is the longest a change could take
 * to reach a second process; in this one, saving clears it at once.
 */
export class RolePermissionCache {
  private value: Chosen | null = null;
  private loadedAt = 0;

  constructor(private readonly ttlMs = 30_000) {}

  async get(load: () => Promise<Chosen>, now: number = Date.now()): Promise<Chosen> {
    if (this.value && now - this.loadedAt < this.ttlMs) return this.value;
    this.value = await load();
    this.loadedAt = now;
    return this.value;
  }

  clear(): void {
    this.value = null;
  }
}

export class DrizzleRolePermissionStore implements RolePermissionStore {
  constructor(
    private readonly db: Db,
    private readonly cache: RolePermissionCache,
    /** Who is saving, for the row. Absent on reads. */
    private readonly by: string | null = null,
  ) {}

  chosen(): Promise<Chosen> {
    return this.cache.get(async () => {
      const rows = await this.db.execute<{ role: string; permissions: string[] }>(
        sql`SELECT role, permissions FROM role_permission_choices`,
      );
      return Object.fromEntries(rows.map((row) => [row.role, row.permissions]));
    });
  }

  async replace(role: string, permissions: readonly string[]): Promise<void> {
    const list = `{${permissions.join(',')}}`;
    await this.db.execute(sql`
      INSERT INTO role_permission_choices (role, permissions, updated_by, updated_at)
      VALUES (${role}, ${list}::text[], ${this.by}, now())
      ON CONFLICT (role) DO UPDATE SET
        permissions = excluded.permissions,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `);
    this.cache.clear();
  }
}
