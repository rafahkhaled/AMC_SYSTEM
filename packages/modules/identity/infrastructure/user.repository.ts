import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UserRepository } from '../application/ports.js';
import { EmailAddress, type Role, User, type UserId, type UserStatus } from '../domain/index.js';
import { userRoles, users } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Rows in, aggregates out. The mapping lives here so that the domain never
 * learns what a column is, and so a schema change has exactly one place to
 * touch.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: UserId): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? this.toAggregate(row, await this.rolesOf(id)) : null;
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.value)).limit(1);
    return row ? this.toAggregate(row, await this.rolesOf(row.id)) : null;
  }

  async save(user: User): Promise<void> {
    const state = user.snapshot();
    await this.db
      .insert(users)
      .values({
        id: state.id,
        email: state.email.value,
        displayName: state.displayName,
        passwordHash: state.passwordHash,
        status: state.status,
        totpSecret: state.totpSecret,
        totpConfirmedAt: state.totpConfirmedAt,
        failedAttempts: state.failedAttempts,
        lockedUntil: state.lockedUntil,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: state.email.value,
          displayName: state.displayName,
          passwordHash: state.passwordHash,
          status: state.status,
          totpSecret: state.totpSecret,
          totpConfirmedAt: state.totpConfirmedAt,
          failedAttempts: state.failedAttempts,
          lockedUntil: state.lockedUntil,
        },
      });

    await this.db.delete(userRoles).where(eq(userRoles.userId, state.id));
    if (state.roles.length > 0) {
      await this.db
        .insert(userRoles)
        .values(state.roles.map((role) => ({ userId: state.id, role })));
    }
  }

  private async rolesOf(id: UserId): Promise<Role[]> {
    const rows = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, id));
    return rows.map((row) => row.role as Role);
  }

  private toAggregate(row: typeof users.$inferSelect, roles: Role[]): User {
    const email = EmailAddress.of(row.email);
    if (!email.ok) {
      // The column is validated on the way in, so this means the row was
      // written by something other than this code.
      throw new Error(`Stored email is not usable: ${row.email}`);
    }
    return User.rehydrate({
      id: row.id,
      email: email.value,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      roles,
      status: row.status as UserStatus,
      totpSecret: row.totpSecret,
      totpConfirmedAt: row.totpConfirmedAt,
      failedAttempts: row.failedAttempts,
      lockedUntil: row.lockedUntil,
    });
  }
}
