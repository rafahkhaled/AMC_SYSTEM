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
