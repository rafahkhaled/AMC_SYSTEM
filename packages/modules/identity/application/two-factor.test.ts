import { describe, expect, it } from 'vitest';
import { EmailAddress, MAX_FAILED_ATTEMPTS, User } from '../domain/index.js';
import { AuthenticateSession } from './authenticate-session.js';
import { SignIn } from './sign-in.js';
import {
  FakePasswordHasher,
  FakeTokenService,
  FakeTwoFactorService,
  InMemorySessionRepository,
  InMemoryUserRepository,
  MovableClock,
  SequentialIds,
} from './test-doubles.js';
import {
  ConfirmTwoFactorEnrolment,
  StartTwoFactorEnrolment,
  VerifyTwoFactor,
} from './two-factor.js';

const LIMITS = { idleMinutes: 30, absoluteHours: 12 };
const START = new Date('2026-09-15T06:00:00Z');
const PASSWORD = 'correct horse battery staple';

function makeManager(): User {
  const email = EmailAddress.of('wael@activemanagement.ae');
  if (!email.ok) throw new Error('fixture');
  const created = User.register({
    id: 'user-1',
    email: email.value,
    displayName: 'Wael Ajam',
    passwordHash: `fake:${PASSWORD}`,
    roles: ['manager'],
    now: START,
  });
  if (!created.ok) throw new Error('fixture');
  created.value.pullEvents();
  return created.value;
}

function build() {
  const user = makeManager();
  const users = new InMemoryUserRepository([user]);
  const sessions = new InMemorySessionRepository();
  const tokens = new FakeTokenService();
  const twoFactor = new FakeTwoFactorService('654321');
  const clock = new MovableClock(START);
  return {
    user,
    users,
    sessions,
    clock,
    twoFactor,
    signIn: new SignIn(
      users,
      sessions,
      new FakePasswordHasher(),
      tokens,
      clock,
      new SequentialIds('session'),
      LIMITS,
    ),
    authenticate: new AuthenticateSession(sessions, users, tokens, clock),
    start: new StartTwoFactorEnrolment(users, twoFactor, clock),
    confirm: new ConfirmTwoFactorEnrolment(users, sessions, twoFactor, clock),
    verify: new VerifyTwoFactor(users, sessions, twoFactor, clock),
  };
}

describe('enrolling in two-factor', () => {
  it('hands out a secret and a URI without switching anything on yet', async () => {
    const { start, user } = build();
    const outcome = await start.execute('user-1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.uri).toContain('otpauth://totp/');
    // An abandoned setup must never lock anyone out.
    expect(user.twoFactorActive).toBe(false);
  });

  it('stores the secret sealed, never in the clear', async () => {
    const { start, user } = build();
    await start.execute('user-1');
    expect(user.totpSecret).toBe('sealed:654321');
    expect(user.totpSecret).not.toBe('654321');
  });

  it('switches on only once a code proves the app holds the secret', async () => {
    const { start, confirm, user } = build();
    await start.execute('user-1');

    const wrong = await confirm.execute({ userId: 'user-1', sessionId: 's', code: '000000' });
    expect(wrong.ok).toBe(false);
    expect(user.twoFactorActive).toBe(false);

    const right = await confirm.execute({ userId: 'user-1', sessionId: 's', code: '654321' });
    expect(right.ok).toBe(true);
    expect(user.twoFactorActive).toBe(true);
  });

  it('refuses to enrol twice', async () => {
    const { start, confirm } = build();
    await start.execute('user-1');
    await confirm.execute({ userId: 'user-1', sessionId: 's', code: '654321' });

    const again = await start.execute('user-1');
    expect(again.ok).toBe(false);
  });
});

describe('signing in once two-factor is on', () => {
  async function enrolledAndSignedIn() {
    const context = build();
    await context.start.execute('user-1');
    await context.confirm.execute({ userId: 'user-1', sessionId: 'setup', code: '654321' });

    const signedIn = await context.signIn.execute({
      email: 'wael@activemanagement.ae',
      password: PASSWORD,
    });
    if (!signedIn.ok) throw new Error('sign-in should have worked');
    return { ...context, signedIn: signedIn.value };
  }

  it('says a second factor is required and holds the session back', async () => {
    const { signedIn, authenticate } = await enrolledAndSignedIn();
    expect(signedIn.twoFactorRequired).toBe(true);

    const caller = await authenticate.execute(signedIn.token);
    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    // The session exists, but is not yet finished.
    expect(caller.value.twoFactorPassed).toBe(false);
  });

  it('completes the session when the code is right', async () => {
    const { signedIn, verify, authenticate } = await enrolledAndSignedIn();

    const outcome = await verify.execute({ sessionId: signedIn.sessionId, code: '654321' });
    expect(outcome.ok).toBe(true);

    const caller = await authenticate.execute(signedIn.token);
    expect(caller.ok && caller.value.twoFactorPassed).toBe(true);
  });

  it('counts a wrong code against the same lockout as a wrong password', async () => {
    const { signedIn, verify, user } = await enrolledAndSignedIn();

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const outcome = await verify.execute({ sessionId: signedIn.sessionId, code: '000000' });
      expect(outcome.ok).toBe(false);
    }

    // Otherwise the code could be guessed at leisure while the password
    // counter stayed untouched.
    expect(user.isLockedAt(START)).toBe(true);
  });

  it('refuses the code once the account is locked, even if the code is right', async () => {
    const { signedIn, verify, user, clock } = await enrolledAndSignedIn();
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await verify.execute({ sessionId: signedIn.sessionId, code: '000000' });
    }
    expect(user.isLockedAt(clock.now())).toBe(true);

    const outcome = await verify.execute({ sessionId: signedIn.sessionId, code: '654321' });
    expect(outcome.ok).toBe(false);
  });

  it('is harmless to verify an already completed session', async () => {
    const { signedIn, verify } = await enrolledAndSignedIn();
    await verify.execute({ sessionId: signedIn.sessionId, code: '654321' });
    expect((await verify.execute({ sessionId: signedIn.sessionId, code: 'anything' })).ok).toBe(
      true,
    );
  });

  it('refuses verification for a session that has expired', async () => {
    const { signedIn, verify, clock } = await enrolledAndSignedIn();
    clock.advanceMinutes(31);
    expect((await verify.execute({ sessionId: signedIn.sessionId, code: '654321' })).ok).toBe(
      false,
    );
  });
});

describe('a user without two-factor', () => {
  it('gets a complete session straight away', async () => {
    const { signIn, authenticate } = build();
    const signedIn = await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: PASSWORD,
    });
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) return;
    expect(signedIn.value.twoFactorRequired).toBe(false);

    const caller = await authenticate.execute(signedIn.value.token);
    expect(caller.ok && caller.value.twoFactorPassed).toBe(true);
  });
});
