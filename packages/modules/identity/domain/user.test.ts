import { describe, expect, it } from 'vitest';
import { EmailAddress } from './email-address.js';
import { MAX_FAILED_ATTEMPTS, User } from './user.js';

const at = (iso: string) => new Date(iso);

function build(roles: Parameters<typeof User.register>[0]['roles'] = ['accountant']): User {
  const email = EmailAddress.of('Wael@Activemanagement.ae');
  if (!email.ok) throw new Error('fixture email should be valid');
  const created = User.register({
    id: 'user-1',
    email: email.value,
    displayName: 'Wael Ajam',
    passwordHash: 'hash',
    roles,
    now: at('2026-09-15T06:00:00Z'),
  });
  if (!created.ok) throw new Error('fixture user should be valid');
  return created.value;
}

describe('User', () => {
  it('normalises the email so one inbox cannot become two accounts', () => {
    expect(build().email.value).toBe('wael@activemanagement.ae');
  });

  it('refuses a user with no role at all', () => {
    const email = EmailAddress.of('nobody@example.com');
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    const created = User.register({
      id: 'user-2',
      email: email.value,
      displayName: 'Nobody',
      passwordHash: 'hash',
      roles: [],
      now: at('2026-09-15T06:00:00Z'),
    });
    expect(created.ok).toBe(false);
  });

  it('requires a second factor of the manager and not of an accountant', () => {
    expect(build(['manager']).requiresTwoFactor).toBe(true);
    expect(build(['accountant']).requiresTwoFactor).toBe(false);
  });

  it('locks the account after five wrong passwords, and not before', () => {
    const user = build();
    const now = at('2026-09-15T06:00:00Z');

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      user.recordFailedAttempt(now);
      expect(user.isLockedAt(now)).toBe(false);
    }

    user.recordFailedAttempt(now);
    expect(user.isLockedAt(now)).toBe(true);
    expect(user.canSignInAt(now).ok).toBe(false);
  });

  it('lets the person back in once the lockout passes', () => {
    const user = build();
    const now = at('2026-09-15T06:00:00Z');
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      user.recordFailedAttempt(now);
    }
    expect(user.canSignInAt(at('2026-09-15T06:14:00Z')).ok).toBe(false);
    expect(user.canSignInAt(at('2026-09-15T06:16:00Z')).ok).toBe(true);
  });

  it('clears the count on a successful sign-in, so wrong attempts do not accumulate for ever', () => {
    const user = build();
    const now = at('2026-09-15T06:00:00Z');
    user.recordFailedAttempt(now);
    user.recordFailedAttempt(now);
    user.recordSuccessfulSignIn(now);
    expect(user.failedAttempts).toBe(0);
  });

  it('refuses a suspended account before any password is checked', () => {
    const user = build();
    user.suspend(at('2026-09-15T06:00:00Z'));
    const outcome = user.canSignInAt(at('2026-09-15T07:00:00Z'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('suspended');
  });

  it('records what happened, for the audit log', () => {
    const user = build();
    user.recordFailedAttempt(at('2026-09-15T06:00:00Z'));
    user.suspend(at('2026-09-15T06:01:00Z'));
    expect(user.pullEvents().map((event) => event.name)).toEqual([
      'identity.user.registered',
      'identity.signin.failed',
      'identity.user.suspended',
    ]);
  });

  it('answers permission questions through its roles', () => {
    expect(build(['manager']).can('users.manage')).toBe(true);
    expect(build(['accountant']).can('users.manage')).toBe(false);
  });
});
