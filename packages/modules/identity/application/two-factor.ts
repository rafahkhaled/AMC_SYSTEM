import { type Clock, Conflict, type Result, err, ok } from '@amc/kernel';
import type { SessionRepository, TwoFactorService, UserRepository } from './ports.js';

/**
 * Enrolment is two steps on purpose. The first hands out a secret; the second
 * proves the authenticator app actually holds it. Activating on the first step
 * would lock people out of their own account whenever a QR code was mis-scanned
 * or the page closed halfway.
 */
export class StartTwoFactorEnrolment {
  constructor(
    private readonly users: UserRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly clock: Clock,
  ) {}

  async execute(userId: string): Promise<Result<{ secret: string; uri: string }, Conflict>> {
    const user = await this.users.findById(userId);
    if (!user) return err(new Conflict('No such user'));
    if (user.twoFactorActive) {
      return err(new Conflict('Two-factor authentication is already switched on'));
    }

    const secret = this.twoFactor.newSecret();
    user.beginTwoFactorEnrolment(this.twoFactor.seal(secret), this.clock.now());
    await this.users.save(user);

    return ok({ secret, uri: this.twoFactor.enrolmentUri(secret, user.email.value) });
  }
}

export class ConfirmTwoFactorEnrolment {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly clock: Clock,
  ) {}

  async execute(params: {
    userId: string;
    sessionId: string;
    code: string;
  }): Promise<Result<true, Conflict>> {
    const user = await this.users.findById(params.userId);
    if (!user?.totpSecret) return err(new Conflict('Start the setup again'));
    if (user.twoFactorActive) {
      return err(new Conflict('Two-factor authentication is already switched on'));
    }

    const now = this.clock.now();
    if (!this.twoFactor.verify(this.twoFactor.open(user.totpSecret), params.code, now)) {
      return err(new Conflict('That code is not right'));
    }

    user.confirmTwoFactor(now);
    await this.users.save(user);

    // The session that switched it on has plainly presented the factor, so it
    // should not be asked for it a second time.
    const found = await this.sessions.findById(params.sessionId);
    if (found) {
      found.session.passTwoFactor(now);
      await this.sessions.save(found.session);
    }
    return ok(true);
  }
}

/**
 * The verification step of a sign-in. A wrong code counts against the same
 * lockout as a wrong password, so a second factor cannot be brute forced while
 * the password stays untouched.
 */
export class VerifyTwoFactor {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly clock: Clock,
  ) {}

  async execute(params: { sessionId: string; code: string }): Promise<Result<true, Conflict>> {
    const now = this.clock.now();
    const found = await this.sessions.findById(params.sessionId);
    if (!found || !found.session.isValidAt(now)) return err(new Conflict('Please sign in again'));
    if (found.session.twoFactorPassed) return ok(true);

    const user = await this.users.findById(found.session.userId);
    if (!user?.totpSecret) return err(new Conflict('Please sign in again'));

    const allowed = user.canSignInAt(now);
    if (!allowed.ok) return err(allowed.error);

    if (!this.twoFactor.verify(this.twoFactor.open(user.totpSecret), params.code, now)) {
      user.recordFailedAttempt(now);
      await this.users.save(user);
      return err(new Conflict('That code is not right'));
    }

    user.recordSuccessfulSignIn(now);
    await this.users.save(user);

    found.session.passTwoFactor(now);
    await this.sessions.save(found.session);
    return ok(true);
  }
}
