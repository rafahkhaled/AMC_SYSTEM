import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthenticateSession } from '../application/authenticate-session.js';
import { RegisterUser } from '../application/register-user.js';
import { SignIn } from '../application/sign-in.js';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { CryptoSessionTokens } from './crypto-session-tokens.js';
import { DrizzleSessionRepository } from './session.repository.js';
import { DrizzleUserRepository } from './user.repository.js';

/**
 * Real Postgres, real argon2, real random tokens. The fakes in the application
 * tests prove the logic; this proves the adapters and the constraints actually
 * hold when the two meet.
 */
const LIMITS = { idleMinutes: 30, absoluteHours: 12 };

class FixedClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

class Ids {
  private counter = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(4, '0')}`;
  }
}

describe('identity against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  function wire(tx: Parameters<Parameters<TestDatabase['inRollbackTransaction']>[0]>[0]) {
    // The rollback transaction is the database for the duration of one test.
    const db = tx as unknown as ReturnType<typeof drizzle>;
    const users = new DrizzleUserRepository(db);
    const sessions = new DrizzleSessionRepository(db);
    const hasher = new Argon2PasswordHasher();
    const tokens = new CryptoSessionTokens();
    const clock = new FixedClock(new Date('2026-09-15T06:00:00Z'));
    return {
      users,
      sessions,
      hasher,
      tokens,
      clock,
      register: new RegisterUser(users, hasher, clock, new Ids('user')),
      signIn: new SignIn(users, sessions, hasher, tokens, clock, new Ids('sess'), LIMITS),
      authenticate: new AuthenticateSession(sessions, users, tokens, clock),
    };
  }

  it('registers a user, signs them in, and recognises the session', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register, signIn, authenticate } = wire(tx);

      const registered = await register.execute({
        email: 'Wael@ActiveManagement.ae',
        displayName: 'Wael Ajam',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });
      expect(registered.ok).toBe(true);

      const signedIn = await signIn.execute({
        email: 'wael@activemanagement.ae',
        password: 'correct horse battery staple',
      });
      expect(signedIn.ok).toBe(true);
      if (!signedIn.ok) return;

      const caller = await authenticate.execute(signedIn.value.token);
      expect(caller.ok).toBe(true);
      if (!caller.ok) return;
      expect(caller.value.displayName).toBe('Wael Ajam');
      expect(caller.value.permissions.has('users.manage')).toBe(true);
    });
  });

  it('stores a real argon2id hash and never the password', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register } = wire(tx);
      await register.execute({
        email: 'accountant@activemanagement.ae',
        displayName: 'An Accountant',
        password: 'correct horse battery staple',
        roles: ['accountant'],
      });

      const [row] = await tx.execute(
        "SELECT password_hash FROM users WHERE email = 'accountant@activemanagement.ae'",
      );
      const stored = (row as { password_hash: string }).password_hash;
      expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(stored).not.toContain('correct horse');
    });
  });

  it('treats two spellings of one address as the same account', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register } = wire(tx);

      const first = await register.execute({
        email: 'wael@activemanagement.ae',
        displayName: 'Wael',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });
      const second = await register.execute({
        email: 'WAEL@ActiveManagement.AE',
        displayName: 'Wael again',
        password: 'a different long password',
        roles: ['accountant'],
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
    });
  });

  it('stores only a hash of the session secret, so a backup grants nothing', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register, signIn } = wire(tx);
      await register.execute({
        email: 'wael@activemanagement.ae',
        displayName: 'Wael',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });
      const signedIn = await signIn.execute({
        email: 'wael@activemanagement.ae',
        password: 'correct horse battery staple',
      });
      if (!signedIn.ok) throw new Error('sign-in should have worked');

      const secret = signedIn.value.token.split('.')[1] ?? '';
      const [row] = await tx.execute('SELECT token_hash FROM sessions');
      const storedHash = (row as { token_hash: string }).token_hash;

      expect(secret.length).toBeGreaterThan(40);
      expect(storedHash).not.toContain(secret);
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('persists the lockout, so restarting the server does not reset it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register, signIn, users } = wire(tx);
      await register.execute({
        email: 'wael@activemanagement.ae',
        displayName: 'Wael',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await signIn.execute({ email: 'wael@activemanagement.ae', password: 'wrong password!!' });
      }

      // Read it back from the database rather than from the object in memory.
      const [row] = await tx.execute(
        "SELECT failed_attempts, locked_until FROM users WHERE email = 'wael@activemanagement.ae'",
      );
      const stored = row as { failed_attempts: number; locked_until: Date | null };
      expect(stored.failed_attempts).toBe(5);
      expect(stored.locked_until).not.toBeNull();

      const reloaded = await users.findById('user-0001');
      expect(reloaded?.isLockedAt(new Date('2026-09-15T06:05:00Z'))).toBe(true);
    });
  });

  it('refuses a role the database does not recognise', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register } = wire(tx);
      await register.execute({
        email: 'wael@activemanagement.ae',
        displayName: 'Wael',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });

      await expect(
        tx.execute("INSERT INTO user_roles (user_id, role) VALUES ('user-0001', 'superuser')"),
      ).rejects.toThrow();
    });
  });

  it('revokes every session at once, which is what a password change needs', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { register, signIn, sessions, authenticate } = wire(tx);
      await register.execute({
        email: 'wael@activemanagement.ae',
        displayName: 'Wael',
        password: 'correct horse battery staple',
        roles: ['manager'],
      });

      const first = await signIn.execute({
        email: 'wael@activemanagement.ae',
        password: 'correct horse battery staple',
      });
      const second = await signIn.execute({
        email: 'wael@activemanagement.ae',
        password: 'correct horse battery staple',
      });
      if (!first.ok || !second.ok) throw new Error('sign-ins should have worked');

      const revoked = await sessions.revokeAllForUser(
        'user-0001',
        new Date('2026-09-15T06:10:00Z'),
      );
      expect(revoked).toBe(2);

      expect((await authenticate.execute(first.value.token)).ok).toBe(false);
      expect((await authenticate.execute(second.value.token)).ok).toBe(false);
    });
  });
});
