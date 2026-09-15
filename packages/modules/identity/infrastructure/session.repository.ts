import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SessionRepository } from '../application/ports.js';
import { Session, type SessionId, type UserId } from '../domain/index.js';
import { sessions } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: SessionId): Promise<{ session: Session; tokenHash: string } | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    if (!row) return null;
    return {
      tokenHash: row.tokenHash,
      session: Session.rehydrate({
        id: row.id,
        userId: row.userId,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        revokedAt: row.revokedAt,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        idleMinutes: row.idleMinutes,
        twoFactorPassed: row.twoFactorPassed,
      }),
    };
  }

  async create(session: Session, tokenHash: string): Promise<void> {
    const state = session.snapshot();
    await this.db.insert(sessions).values({
      id: state.id,
      userId: state.userId,
      tokenHash,
      createdAt: state.createdAt,
      lastSeenAt: state.lastSeenAt,
      absoluteExpiresAt: state.absoluteExpiresAt,
      revokedAt: state.revokedAt,
      idleMinutes: state.idleMinutes,
      ipAddress: state.ipAddress,
      userAgent: state.userAgent,
      twoFactorPassed: state.twoFactorPassed,
    });
  }

  async save(session: Session): Promise<void> {
    const state = session.snapshot();
    await this.db
      .update(sessions)
      .set({
        lastSeenAt: state.lastSeenAt,
        revokedAt: state.revokedAt,
        twoFactorPassed: state.twoFactorPassed,
      })
      .where(eq(sessions.id, state.id));
  }

  async revokeAllForUser(userId: UserId, at: Date): Promise<number> {
    const revoked = await this.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return revoked.length;
  }
}
