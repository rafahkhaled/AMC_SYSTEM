import { type Clock, type IdGenerator } from '@amc/kernel';
import type { EmailAddress, Session, SessionId, User, UserId } from '../domain/index.js';
import type {
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  TwoFactorService,
  UserRepository,
} from './ports.js';

/**
 * Fakes, not mocks. They behave like the real thing well enough that a use case
 * test exercises real logic, and they hold no expectations about how they are
 * called, so a refactor does not break twenty tests that assert on plumbing.
 */
export class InMemoryUserRepository implements UserRepository {
  readonly saved: User[] = [];
  private byId = new Map<UserId, User>();

  constructor(users: User[] = []) {
    for (const user of users) this.byId.set(user.id, user);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email.equals(email)) return user;
    }
    return null;
  }

  async save(user: User): Promise<void> {
    this.byId.set(user.id, user);
    this.saved.push(user);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private records = new Map<SessionId, { session: Session; tokenHash: string }>();

  async findById(id: SessionId): Promise<{ session: Session; tokenHash: string } | null> {
    return this.records.get(id) ?? null;
  }

  async create(session: Session, tokenHash: string): Promise<void> {
    this.records.set(session.id, { session, tokenHash });
  }

  async save(session: Session): Promise<void> {
    const existing = this.records.get(session.id);
    if (existing) this.records.set(session.id, { ...existing, session });
  }

  async revokeAllForUser(userId: UserId, at: Date): Promise<number> {
    let revoked = 0;
    for (const record of this.records.values()) {
      if (record.session.userId === userId && record.session.revokedAt === null) {
        record.session.revoke(at);
        revoked += 1;
      }
    }
    return revoked;
  }
}

/** Reversible, obviously fake, and fast. Never let this near production. */
export class FakePasswordHasher implements PasswordHasher {
  calls = 0;
  constructor(private readonly weakHashes = new Set<string>()) {}

  async hash(plaintext: string): Promise<string> {
    return `fake:${plaintext}`;
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    this.calls += 1;
    return hash === `fake:${plaintext}`;
  }

  needsRehash(hash: string): boolean {
    return this.weakHashes.has(hash);
  }
}

export class FakeTokenService implements SessionTokenService {
  private counter = 0;

  issue(): { token: string; tokenHash: string } {
    this.counter += 1;
    const token = `token-${this.counter}`;
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return `hashed:${token}`;
  }

  matches(tokenHash: string, token: string): boolean {
    return tokenHash === this.hash(token);
  }
}

/**
 * A predictable stand-in for the time-based algorithm: the code is always the
 * secret's own digits. The real implementation is proved against the RFC's
 * published vectors elsewhere; here the question is the surrounding flow.
 */
export class FakeTwoFactorService implements TwoFactorService {
  constructor(readonly secret = '123456') {}

  newSecret(): string {
    return this.secret;
  }

  enrolmentUri(secretBase32: string, account: string): string {
    return `otpauth://totp/AMC:${account}?secret=${secretBase32}`;
  }

  verify(secretBase32: string, code: string): boolean {
    return code.replace(/\s/g, '') === secretBase32;
  }

  async seal(secretBase32: string): Promise<string> {
    return `sealed:${secretBase32}`;
  }

  async open(sealed: string): Promise<string> {
    if (!sealed.startsWith('sealed:')) throw new Error('not sealed by this service');
    return sealed.slice('sealed:'.length);
  }
}

export class SequentialIds implements IdGenerator {
  private counter = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

export class MovableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
