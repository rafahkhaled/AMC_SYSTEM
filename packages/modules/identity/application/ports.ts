import type { EmailAddress, Session, SessionId, User, UserId } from '../domain/index.js';

/**
 * Everything this module needs from the outside world, stated as interfaces it
 * owns. Adapters implement these; the use cases never learn which database or
 * which hashing library is behind them.
 */

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface SessionRepository {
  findById(id: SessionId): Promise<{ session: Session; tokenHash: string } | null>;
  create(session: Session, tokenHash: string): Promise<void>;
  save(session: Session): Promise<void>;
  revokeAllForUser(userId: UserId, at: Date): Promise<number>;
}

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  /** Must take the same time whether or not the hash matches. */
  verify(hash: string, plaintext: string): Promise<boolean>;
  /** True when a stored hash was made with weaker settings and should be renewed. */
  needsRehash(hash: string): boolean;
}

/**
 * A session identifier is a ULID, which sorts by time and is therefore
 * guessable. It can name a session but must never authorise one, so every
 * session also carries a random secret. The cookie holds both; the database
 * holds only a hash of the secret, so a stolen database backup does not hand
 * over live sessions.
 */
/**
 * Time-based codes, and the sealing of the secret they come from. Both are
 * ports so the algorithm and the key custody can be replaced independently:
 * P0-14 moves sealing to a KMS-backed vault without this module noticing.
 */
export interface TwoFactorService {
  /** A fresh secret, base32, ready to be shown as a QR code. */
  newSecret(): string;
  /** The enrolment URI an authenticator app reads. */
  enrolmentUri(secretBase32: string, account: string): string;
  verify(secretBase32: string, code: string, at: Date): boolean;
  /**
   * Sealing and opening are asynchronous because real key custody is a call to
   * KMS, not a local computation. Pretending otherwise would mean rewriting
   * every caller the day production stopped holding its own master key.
   */
  seal(secretBase32: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export interface SessionTokenService {
  issue(): { token: string; tokenHash: string };
  hash(token: string): string;
  /** Constant-time comparison, so a timing difference reveals nothing. */
  matches(tokenHash: string, token: string): boolean;
}

/**
 * Links for people who have forgotten their password.
 *
 * Only a hash of the token is kept, like a session's, so a copy of the
 * database cannot be used to take over an account.
 */
export interface PasswordResetRepository {
  /** Stores a new link and voids any earlier unused ones for the same person. */
  issue(params: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
    now: Date;
  }): Promise<void>;
  /** The person a token belongs to, when it is unused and not yet expired. */
  findLive(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null>;
  markUsed(id: string, at: Date): Promise<void>;
}

/** Sends the link. Outside the transaction: a mail server being down is not a rollback. */
export interface PasswordResetMailer {
  send(params: { to: string; displayName: string; token: string }): Promise<void>;
}

/**
 * What the firm has chosen each editable role may do.
 *
 * Read on every request, so the implementation caches; a change made from
 * Settings clears the cache, so it takes effect on the next request rather than
 * the next sign-in.
 */
export interface RolePermissionStore {
  /** The chosen grantable permissions, by role. A role with no entry keeps its defaults. */
  chosen(): Promise<Partial<Record<string, readonly string[]>>>;
  replace(role: string, permissions: readonly string[]): Promise<void>;
}
