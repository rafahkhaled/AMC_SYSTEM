import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';
import type { EmailAddress } from './email-address.js';
import {
  type Permission,
  ROLES_REQUIRING_TWO_FACTOR,
  type Role,
  permissionsFor,
} from './permission.js';

export type UserId = string;
export type UserStatus = 'active' | 'suspended';

/**
 * How many wrong passwords before the account stops answering, and for how
 * long. This is the cheapest defence against someone working through a list of
 * passwords, and the lockout is short enough that a person who simply forgot
 * theirs is not locked out of their working day.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export interface UserState {
  readonly id: UserId;
  readonly email: EmailAddress;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly roles: readonly Role[];
  readonly status: UserStatus;
  /** Sealed, never the raw secret. See SecretBox in the infrastructure layer. */
  readonly totpSecret: string | null;
  /** Null until the person has proved they can produce a code from it. */
  readonly totpConfirmedAt: Date | null;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export class User extends AggregateRoot<UserId> {
  private constructor(private state: UserState) {
    super(state.id);
  }

  static rehydrate(state: UserState): User {
    return new User(state);
  }

  static register(params: {
    id: UserId;
    email: EmailAddress;
    displayName: string;
    passwordHash: string;
    roles: readonly Role[];
    now: Date;
  }): Result<User, Conflict> {
    if (params.roles.length === 0) {
      return err(new Conflict('A user must have at least one role'));
    }
    const user = new User({
      id: params.id,
      email: params.email,
      displayName: params.displayName.trim(),
      passwordHash: params.passwordHash,
      roles: [...params.roles],
      status: 'active',
      totpSecret: null,
      totpConfirmedAt: null,
      failedAttempts: 0,
      lockedUntil: null,
    });
    user.record(
      domainEvent('identity.user.registered', params.id, params.now, {
        userId: params.id,
        email: params.email.value,
        roles: params.roles,
      }),
    );
    return ok(user);
  }

  get email(): EmailAddress {
    return this.state.email;
  }

  get displayName(): string {
    return this.state.displayName;
  }

  get passwordHash(): string {
    return this.state.passwordHash;
  }

  get roles(): readonly Role[] {
    return this.state.roles;
  }

  get status(): UserStatus {
    return this.state.status;
  }

  get totpSecret(): string | null {
    return this.state.totpSecret;
  }

  get totpConfirmedAt(): Date | null {
    return this.state.totpConfirmedAt;
  }

  /** Two-factor counts only once a code has actually been produced from it. */
  get twoFactorActive(): boolean {
    return this.state.totpSecret !== null && this.state.totpConfirmedAt !== null;
  }

  get failedAttempts(): number {
    return this.state.failedAttempts;
  }

  get lockedUntil(): Date | null {
    return this.state.lockedUntil;
  }

  get permissions(): ReadonlySet<Permission> {
    return permissionsFor(this.state.roles);
  }

  can(permission: Permission): boolean {
    return this.permissions.has(permission);
  }

  /** Whether this user must present a second factor, by role. */
  get requiresTwoFactor(): boolean {
    return this.state.roles.some((role) => ROLES_REQUIRING_TWO_FACTOR.includes(role));
  }

  isLockedAt(now: Date): boolean {
    return this.state.lockedUntil !== null && this.state.lockedUntil.getTime() > now.getTime();
  }

  /**
   * Whether a sign-in may proceed at all, before the password is even checked.
   * Answering this first keeps a suspended account from being probed.
   */
  canSignInAt(now: Date): Result<true, Conflict> {
    if (this.state.status === 'suspended') {
      return err(new Conflict('This account is suspended'));
    }
    if (this.isLockedAt(now)) {
      return err(
        new Conflict('Too many failed attempts. Try again shortly.', {
          lockedUntil: this.state.lockedUntil?.toISOString(),
        }),
      );
    }
    return ok(true);
  }

  recordFailedAttempt(now: Date): void {
    const failedAttempts = this.state.failedAttempts + 1;
    const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;
    this.state = {
      ...this.state,
      failedAttempts,
      lockedUntil: shouldLock
        ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
        : this.state.lockedUntil,
    };
    this.record(
      domainEvent('identity.signin.failed', this.id, now, {
        userId: this.id,
        failedAttempts,
        locked: shouldLock,
      }),
    );
  }

  recordSuccessfulSignIn(now: Date): void {
    this.state = { ...this.state, failedAttempts: 0, lockedUntil: null };
    this.record(domainEvent('identity.signin.succeeded', this.id, now, { userId: this.id }));
  }

  changePassword(passwordHash: string, now: Date): void {
    this.state = { ...this.state, passwordHash, failedAttempts: 0, lockedUntil: null };
    this.record(domainEvent('identity.password.changed', this.id, now, { userId: this.id }));
  }

  /**
   * Stores a sealed secret without activating it. An enrolment that is started
   * and abandoned must never lock someone out, so the secret does nothing
   * until a code proves the authenticator app really holds it.
   */
  beginTwoFactorEnrolment(sealedSecret: string, now: Date): void {
    this.state = { ...this.state, totpSecret: sealedSecret, totpConfirmedAt: null };
    this.record(
      domainEvent('identity.twofactor.enrolment_started', this.id, now, { userId: this.id }),
    );
  }

  confirmTwoFactor(now: Date): void {
    this.state = { ...this.state, totpConfirmedAt: now };
    this.record(domainEvent('identity.twofactor.enabled', this.id, now, { userId: this.id }));
  }

  disableTwoFactor(now: Date): void {
    this.state = { ...this.state, totpSecret: null, totpConfirmedAt: null };
    this.record(domainEvent('identity.twofactor.disabled', this.id, now, { userId: this.id }));
  }

  suspend(now: Date): void {
    this.state = { ...this.state, status: 'suspended' };
    this.record(domainEvent('identity.user.suspended', this.id, now, { userId: this.id }));
  }

  reinstate(now: Date): void {
    this.state = { ...this.state, status: 'active', failedAttempts: 0, lockedUntil: null };
    this.record(domainEvent('identity.user.reinstated', this.id, now, { userId: this.id }));
  }

  snapshot(): UserState {
    return this.state;
  }
}
