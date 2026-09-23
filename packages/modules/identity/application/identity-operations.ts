import {
  type Actor,
  Conflict,
  type EventCollector,
  type Result,
  type UnitOfWork,
  type UnitOfWorkContext,
  ValidationFailed,
  err,
  ok,
} from '@amc/kernel';
import type { Role, SessionLimits } from '../domain/index.js';
import { AuthenticateSession } from './authenticate-session.js';
import type {
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  TwoFactorService,
  UserRepository,
} from './ports.js';
import { RegisterUser, type RegisterUserCommand } from './register-user.js';
import { SignIn, type SignInCommand, type SignInResult } from './sign-in.js';
import { SignOut } from './sign-out.js';
import {
  ConfirmTwoFactorEnrolment,
  StartTwoFactorEnrolment,
  VerifyTwoFactor,
} from './two-factor.js';

/**
 * Repositories bound to one transaction, built by the infrastructure layer.
 * The application knows it can ask for them; it does not know what a
 * transaction is made of.
 */
export interface RepositoryFactory {
  forTransaction(
    transaction: unknown,
    collector: EventCollector,
  ): { users: UserRepository; sessions: SessionRepository };
}

export interface IdentityDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly repositories: RepositoryFactory;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokenService;
  readonly twoFactor: TwoFactorService;
  readonly clock: { now(): Date };
  readonly ids: { next(): string };
  readonly limits: SessionLimits;
}

/**
 * Every operation that changes something runs inside one transaction, and the
 * audit rows are written by that same transaction. This is the seam that makes
 * ADR-0004 true rather than aspirational: a sign-in that commits cannot be
 * missing from the log, and a sign-in that fails leaves nothing behind.
 *
 * Reading a session deliberately stays outside, because it happens on every
 * request and records nothing worth keeping.
 */
export class IdentityOperations {
  constructor(private readonly dependencies: IdentityDependencies) {}

  private inTransaction<T>(
    actor: Actor,
    work: (
      repositories: ReturnType<RepositoryFactory['forTransaction']>,
      context: UnitOfWorkContext,
    ) => Promise<T>,
  ): Promise<T> {
    return this.dependencies.unitOfWork.run(actor, async (context) => {
      const repositories = this.dependencies.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      return work(repositories, context);
    });
  }

  signIn(actor: Actor, command: SignInCommand): Promise<Result<SignInResult, Conflict>> {
    const { hasher, tokens, clock, ids, limits } = this.dependencies;
    return this.inTransaction(actor, async ({ users, sessions }, context) => {
      const outcome = await new SignIn(users, sessions, hasher, tokens, clock, ids, limits).execute(
        command,
      );

      // Now that the password has been proven, the rows this transaction is
      // about to write can name the person instead of nobody. A failed
      // attempt stays anonymous, which is the honest record of what happened.
      if (outcome.ok) {
        context.identify({
          ...actor,
          userId: outcome.value.actor.userId,
          roles: outcome.value.actor.roles,
          label: outcome.value.displayName,
          sessionId: outcome.value.sessionId,
        });
      }
      return outcome;
    });
  }

  signOutOne(actor: Actor, sessionId: string): Promise<void> {
    return this.inTransaction(actor, ({ sessions }) =>
      new SignOut(sessions, this.dependencies.clock).one(sessionId),
    );
  }

  signOutEverywhere(actor: Actor, userId: string): Promise<number> {
    return this.inTransaction(actor, ({ sessions }) =>
      new SignOut(sessions, this.dependencies.clock).everywhere(userId),
    );
  }

  registerUser(
    actor: Actor,
    command: RegisterUserCommand,
  ): Promise<Result<{ userId: string }, Conflict | ValidationFailed>> {
    const { hasher, clock, ids } = this.dependencies;
    return this.inTransaction(actor, ({ users }) =>
      new RegisterUser(users, hasher, clock, ids).execute(command),
    );
  }

  startTwoFactor(
    actor: Actor,
    userId: string,
  ): Promise<Result<{ secret: string; uri: string }, Conflict>> {
    const { twoFactor, clock } = this.dependencies;
    return this.inTransaction(actor, ({ users }) =>
      new StartTwoFactorEnrolment(users, twoFactor, clock).execute(userId),
    );
  }

  confirmTwoFactor(
    actor: Actor,
    params: { userId: string; sessionId: string; code: string },
  ): Promise<Result<true, Conflict>> {
    const { twoFactor, clock } = this.dependencies;
    return this.inTransaction(actor, ({ users, sessions }) =>
      new ConfirmTwoFactorEnrolment(users, sessions, twoFactor, clock).execute(params),
    );
  }

  verifyTwoFactor(
    actor: Actor,
    params: { sessionId: string; code: string },
  ): Promise<Result<true, Conflict>> {
    const { twoFactor, clock } = this.dependencies;
    return this.inTransaction(actor, ({ users, sessions }) =>
      new VerifyTwoFactor(users, sessions, twoFactor, clock).execute(params),
    );
  }

  /* ------------------------------------------------- managing people -- */

  /**
   * Adding a colleague (FR-03).
   *
   * Inside the same transaction as everything else that changes something, so
   * the audit row and the account commit together. An account that exists
   * with nobody recorded as having created it is precisely what ADR-0004
   * exists to prevent.
   */
  addStaff(
    actor: Actor,
    command: RegisterUserCommand,
  ): Promise<Result<{ userId: string }, Conflict | ValidationFailed>> {
    const { hasher, clock, ids } = this.dependencies;
    return this.inTransaction(actor, ({ users }) =>
      new RegisterUser(users, hasher, clock, ids).execute(command),
    );
  }

  /**
   * Changing a colleague's name or what they may do.
   *
   * Both in one call because they are one act — somebody looked at a person's
   * record and corrected it — and two calls would leave a half-applied change
   * if the second failed.
   */
  updateStaff(
    actor: Actor,
    userId: string,
    changes: { displayName?: string | undefined; roles?: readonly Role[] | undefined },
  ): Promise<Result<true, Conflict | ValidationFailed>> {
    const { clock } = this.dependencies;
    return this.inTransaction(actor, async ({ users }) => {
      const user = await users.findById(userId);
      if (!user) return err(new Conflict('There is no such person'));

      const now = clock.now();
      if (changes.displayName !== undefined) {
        const renamed = user.rename(changes.displayName, now);
        if (!renamed.ok) return err(renamed.error);
      }
      if (changes.roles !== undefined) {
        const assigned = user.assignRoles(changes.roles, now);
        if (!assigned.ok) return err(assigned.error);
      }

      await users.save(user);
      return ok(true as const);
    });
  }

  /**
   * Taking somebody off the system, or putting them back.
   *
   * Suspension, not deletion, and not because deletion is hard: a person's id
   * is on every hour they recorded, every project they were assigned and
   * every audit row they caused. Removing the row would either orphan all of
   * that or cascade it away, and a practice that cannot say who did the work
   * it invoiced has a worse problem than a long staff list.
   */
  setStaffStatus(
    actor: Actor,
    userId: string,
    status: 'active' | 'suspended',
  ): Promise<Result<true, Conflict>> {
    const { clock } = this.dependencies;
    return this.inTransaction(actor, async ({ users, sessions }) => {
      const user = await users.findById(userId);
      if (!user) return err(new Conflict('There is no such person'));

      if (status === 'suspended') {
        if (user.id === actor.userId) {
          // Otherwise the last manager can lock the firm out of its own
          // system, and there is no second manager to undo it.
          return err(new Conflict('You cannot suspend your own account'));
        }
        user.suspend(clock.now());
        // Suspension has to reach the sessions they already hold, or somebody
        // walked out on Friday keeps their laptop signed in until it expires.
        await sessions.revokeAllForUser(userId, clock.now());
      } else {
        user.reinstate(clock.now());
      }

      await users.save(user);
      return ok(true as const);
    });
  }

  /** Reads only, and outside any transaction of ours. */
  authenticate(repositories: {
    users: UserRepository;
    sessions: SessionRepository;
  }): AuthenticateSession {
    const { tokens, clock } = this.dependencies;
    return new AuthenticateSession(repositories.sessions, repositories.users, tokens, clock);
  }
}
