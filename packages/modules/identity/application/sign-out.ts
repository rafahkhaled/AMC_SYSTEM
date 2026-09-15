import type { Clock } from '@amc/kernel';
import type { SessionRepository } from './ports.js';

/** Ends one session, or every session a person has, after a password change. */
export class SignOut {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async one(sessionId: string): Promise<void> {
    const found = await this.sessions.findById(sessionId);
    if (!found) return;
    found.session.revoke(this.clock.now());
    await this.sessions.save(found.session);
  }

  async everywhere(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId, this.clock.now());
  }
}
