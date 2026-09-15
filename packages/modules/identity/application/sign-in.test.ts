import { describe, expect, it } from 'vitest';
import { EmailAddress, MAX_FAILED_ATTEMPTS, User } from '../domain/index.js';
import { AuthenticateSession } from './authenticate-session.js';
import { SignIn } from './sign-in.js';
import {
  FakePasswordHasher,
  FakeTokenService,
  InMemorySessionRepository,
  InMemoryUserRepository,
  MovableClock,
  SequentialIds,
} from './test-doubles.js';

const LIMITS = { idleMinutes: 30, absoluteHours: 12 };
const START = new Date('2026-09-15T06:00:00Z');

function makeUser(passwordHash = 'fake:correct horse battery staple'): User {
  const email = EmailAddress.of('wael@activemanagement.ae');
  if (!email.ok) throw new Error('fixture');
  const created = User.register({
    id: 'user-1',
    email: email.value,
    displayName: 'Wael Ajam',
    passwordHash,
    roles: ['manager'],
    now: START,
  });
  if (!created.ok) throw new Error('fixture');
  created.value.pullEvents();
  return created.value;
}

function build(options: { user?: User; weakHashes?: Set<string> } = {}) {
  const user = options.user ?? makeUser();
  const users = new InMemoryUserRepository([user]);
  const sessions = new InMemorySessionRepository();
  const hasher = new FakePasswordHasher(options.weakHashes);
  const tokens = new FakeTokenService();
  const clock = new MovableClock(START);
  const signIn = new SignIn(
    users,
    sessions,
    hasher,
    tokens,
    clock,
    new SequentialIds('session'),
    LIMITS,
  );
  const authenticate = new AuthenticateSession(sessions, users, tokens, clock);
  return { user, users, sessions, hasher, clock, signIn, authenticate };
}

describe('signing in', () => {
  it('issues a session for the right password', async () => {
    const { signIn } = build();
    const outcome = await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.actor.roles).toEqual(['manager']);
    expect(outcome.value.token).toMatch(/^session-1\./);
  });

  it('says the same thing for an unknown address as for a wrong password', async () => {
    const { signIn } = build();

    const unknown = await signIn.execute({
      email: 'nobody@example.com',
      password: 'whatever12345',
    });
    const wrong = await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'not the password',
    });

    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (unknown.ok || wrong.ok) return;
    // Identical wording, so nobody can harvest which addresses have accounts.
    expect(unknown.error.message).toBe(wrong.error.message);
  });

  it('still verifies a hash for an unknown address, so the timing gives nothing away', async () => {
    const { signIn, hasher } = build();
    await signIn.execute({ email: 'nobody@example.com', password: 'whatever12345' });
    expect(hasher.calls).toBe(1);
  });

  it('counts wrong attempts and locks the account at the limit', async () => {
    const { signIn, user } = build();

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await signIn.execute({ email: 'wael@activemanagement.ae', password: 'wrong password!' });
    }

    expect(user.isLockedAt(START)).toBe(true);

    // The right password no longer helps while the lock stands.
    const outcome = await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('Too many failed attempts');
  });

  it('upgrades a hash made with weaker settings, while the password is in hand', async () => {
    const weak = 'fake:correct horse battery staple';
    const { signIn, user } = build({ weakHashes: new Set([weak]) });

    await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });

    const changed = user.pullEvents().some((event) => event.name === 'identity.password.changed');
    expect(changed).toBe(true);
  });

  it('refuses a suspended account', async () => {
    const user = makeUser();
    user.suspend(START);
    const { signIn } = build({ user });

    const outcome = await signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });
    expect(outcome.ok).toBe(false);
  });
});

describe('using a session', () => {
  async function signedIn() {
    const context = build();
    const outcome = await context.signIn.execute({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });
    if (!outcome.ok) throw new Error('sign-in should have worked');
    return { ...context, token: outcome.value.token };
  }

  it('recognises the caller and their permissions', async () => {
    const { authenticate, token } = await signedIn();
    const caller = await authenticate.execute(token);

    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    expect(caller.value.userId).toBe('user-1');
    expect(caller.value.permissions.has('users.manage')).toBe(true);
  });

  it('refuses a token whose secret is wrong, even with a real session id', async () => {
    const { authenticate } = await signedIn();
    const caller = await authenticate.execute('session-1.not-the-secret');
    expect(caller.ok).toBe(false);
  });

  it('refuses a malformed cookie', async () => {
    const { authenticate } = await signedIn();
    for (const value of ['', 'nodot', '.leading', 'session-1.']) {
      expect((await authenticate.execute(value)).ok).toBe(false);
    }
  });

  it('slides the idle window forward on every use', async () => {
    const { authenticate, clock, token } = await signedIn();

    clock.advanceMinutes(25);
    expect((await authenticate.execute(token)).ok).toBe(true);

    // Another twenty-five minutes. Without the slide this would be past thirty.
    clock.advanceMinutes(25);
    expect((await authenticate.execute(token)).ok).toBe(true);
  });

  it('expires after thirty idle minutes', async () => {
    const { authenticate, clock, token } = await signedIn();
    clock.advanceMinutes(31);
    expect((await authenticate.execute(token)).ok).toBe(false);
  });

  it('ends at twelve hours however active the session has been', async () => {
    const { authenticate, clock, token } = await signedIn();

    for (let elapsed = 0; elapsed < 12 * 60 - 20; elapsed += 20) {
      clock.advanceMinutes(20);
      expect((await authenticate.execute(token)).ok).toBe(true);
    }

    clock.advanceMinutes(20);
    expect((await authenticate.execute(token)).ok).toBe(false);
  });

  it('stops a suspended user on their next request, not at their next sign-in', async () => {
    const { authenticate, user, users, token, clock } = await signedIn();
    user.suspend(clock.now());
    await users.save(user);

    expect((await authenticate.execute(token)).ok).toBe(false);
  });
});
