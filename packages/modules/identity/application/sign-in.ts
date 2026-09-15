import {
  type Actor,
  type Clock,
  Conflict,
  type IdGenerator,
  type Result,
  err,
  ok,
} from '@amc/kernel';
import { EmailAddress, Session, type SessionLimits } from '../domain/index.js';
import type {
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  UserRepository,
} from './ports.js';

export interface SignInCommand {
  readonly email: string;
  readonly password: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface SignInResult {
  readonly sessionId: string;
  readonly token: string;
  readonly actor: Actor;
  readonly displayName: string;
  readonly expiresAt: Date;
  readonly twoFactorRequired: boolean;
}

/**
 * A single failure message for every way a sign-in can fail on credentials.
 *
 * Saying "no such user" would let anyone test which addresses have accounts,
 * which is a list worth having if you intend to try passwords against them.
 */
const REFUSED = 'Those details are not right';

export class SignIn {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly limits: SessionLimits,
  ) {}

  async execute(command: SignInCommand): Promise<Result<SignInResult, Conflict>> {
    const now = this.clock.now();

    const email = EmailAddress.of(command.email);
    if (!email.ok) return err(new Conflict(REFUSED));

    const user = await this.users.findByEmail(email.value);
    if (!user) {
      // Spend the time anyway. Returning instantly for an unknown address
      // tells an attacker the address is unknown.
      await this.hasher.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        command.password,
      );
      return err(new Conflict(REFUSED));
    }

    const allowed = user.canSignInAt(now);
    if (!allowed.ok) return err(allowed.error);

    const correct = await this.hasher.verify(user.passwordHash, command.password);
    if (!correct) {
      user.recordFailedAttempt(now);
      await this.users.save(user);
      return err(new Conflict(REFUSED));
    }

    // A password proven correct against an older hashing cost is re-hashed now,
    // while the plaintext is in hand and nobody has to be asked to change it.
    if (this.hasher.needsRehash(user.passwordHash)) {
      user.changePassword(await this.hasher.hash(command.password), now);
    }

    user.recordSuccessfulSignIn(now);
    await this.users.save(user);

    const session = Session.start({
      id: this.ids.next(),
      userId: user.id,
      now,
      limits: this.limits,
      ipAddress: command.ipAddress ?? null,
      userAgent: command.userAgent ?? null,
    });
    const { token, tokenHash } = this.tokens.issue();
    await this.sessions.create(session, tokenHash);

    return ok({
      sessionId: session.id,
      token: `${session.id}.${token}`,
      actor: {
        userId: user.id,
        roles: [...user.roles],
        ipAddress: command.ipAddress ?? undefined,
      },
      displayName: user.displayName,
      expiresAt: session.idleExpiresAt,
      twoFactorRequired: user.requiresTwoFactor && user.totpSecret !== null,
    });
  }
}
