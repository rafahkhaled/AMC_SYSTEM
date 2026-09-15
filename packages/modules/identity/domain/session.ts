import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';
import type { UserId } from './user.js';

export type SessionId = string;

/**
 * Two expiries, and both are needed (NFR-04).
 *
 * The idle limit covers the laptop left open in a coffee shop. The absolute
 * limit covers the session that never idles because a browser tab keeps polling
 * it, which would otherwise live forever. A session dies at whichever comes
 * first.
 */
export interface SessionLimits {
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}

export interface SessionState {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly idleMinutes: number;
  /**
   * A session that has shown the password but not yet the second factor is
   * real, and deliberately so: it exists only to carry the verification step.
   * Until this is true it may reach nothing else.
   */
  readonly twoFactorPassed: boolean;
}

export class Session extends AggregateRoot<SessionId> {
  private constructor(private state: SessionState) {
    super(state.id);
  }

  static rehydrate(state: SessionState): Session {
    return new Session(state);
  }

  static start(params: {
    id: SessionId;
    userId: UserId;
    now: Date;
    limits: SessionLimits;
    ipAddress?: string | null;
    userAgent?: string | null;
    twoFactorPassed: boolean;
  }): Session {
    const session = new Session({
      id: params.id,
      userId: params.userId,
      createdAt: params.now,
      lastSeenAt: params.now,
      absoluteExpiresAt: new Date(params.now.getTime() + params.limits.absoluteHours * 3_600_000),
      revokedAt: null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      idleMinutes: params.limits.idleMinutes,
      twoFactorPassed: params.twoFactorPassed,
    });
    session.record(
      domainEvent('identity.session.started', params.id, params.now, {
        sessionId: params.id,
        userId: params.userId,
      }),
    );
    return session;
  }

  get userId(): UserId {
    return this.state.userId;
  }

  get lastSeenAt(): Date {
    return this.state.lastSeenAt;
  }

  get absoluteExpiresAt(): Date {
    return this.state.absoluteExpiresAt;
  }

  get revokedAt(): Date | null {
    return this.state.revokedAt;
  }

  get twoFactorPassed(): boolean {
    return this.state.twoFactorPassed;
  }

  /** Records that the second factor was presented for this session. */
  passTwoFactor(now: Date): void {
    if (this.state.twoFactorPassed) return;
    this.state = { ...this.state, twoFactorPassed: true, lastSeenAt: now };
    this.record(
      domainEvent('identity.session.two_factor_passed', this.id, now, {
        sessionId: this.id,
        userId: this.state.userId,
      }),
    );
  }

  /** When this session dies from inactivity, given when it was last used. */
  get idleExpiresAt(): Date {
    return new Date(this.state.lastSeenAt.getTime() + this.state.idleMinutes * 60_000);
  }

  isValidAt(now: Date): boolean {
    if (this.state.revokedAt !== null) return false;
    if (now.getTime() >= this.state.absoluteExpiresAt.getTime()) return false;
    return now.getTime() < this.idleExpiresAt.getTime();
  }

  /**
   * Mark the session used. Returns a failure rather than silently extending an
   * expired session, so the caller has to deal with it.
   */
  touch(now: Date): Result<true, Conflict> {
    if (this.state.revokedAt !== null) {
      return err(new Conflict('This session was signed out'));
    }
    if (now.getTime() >= this.state.absoluteExpiresAt.getTime()) {
      return err(new Conflict('This session has reached its maximum length. Sign in again.'));
    }
    if (now.getTime() >= this.idleExpiresAt.getTime()) {
      return err(new Conflict('This session expired through inactivity. Sign in again.'));
    }
    this.state = { ...this.state, lastSeenAt: now };
    return ok(true);
  }

  revoke(now: Date): void {
    if (this.state.revokedAt !== null) return;
    this.state = { ...this.state, revokedAt: now };
    this.record(
      domainEvent('identity.session.revoked', this.id, now, {
        sessionId: this.id,
        userId: this.state.userId,
      }),
    );
  }

  snapshot(): SessionState {
    return this.state;
  }
}
