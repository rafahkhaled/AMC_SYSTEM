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
export interface SessionTokenService {
  issue(): { token: string; tokenHash: string };
  hash(token: string): string;
  /** Constant-time comparison, so a timing difference reveals nothing. */
  matches(tokenHash: string, token: string): boolean;
}
