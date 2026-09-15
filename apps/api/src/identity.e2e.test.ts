import 'reflect-metadata';
import { MIGRATIONS_DIRECTORY, runMigrations } from '@amc/database';
import { RegisterUser } from '@amc/identity';
import { SecretBox, totp } from '@amc/identity/infrastructure';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';

/**
 * The whole path, end to end: a real HTTP request, the real guards, real
 * argon2 and a real database. The unit tests prove the rules; this proves the
 * wiring, which is where a security control is usually lost.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';

const PASSWORD = 'correct horse battery staple';

/** supertest types set-cookie loosely; this keeps the call sites honest. */
function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  if (Array.isArray(header)) return header as string[];
  return typeof header === 'string' ? [header] : [];
}
const MANAGER = `manager-${Date.now()}@activemanagement.ae`;
const CLERK = `clerk-${Date.now()}@activemanagement.ae`;

describe('signing in over HTTP', () => {
  let app: INestApplication;
  let sql: postgres.Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.NODE_ENV = 'test';

    sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const register = app.get(RegisterUser);
    await register.execute({
      email: MANAGER,
      displayName: 'Wael Ajam',
      password: PASSWORD,
      roles: ['manager'],
    });
    await register.execute({
      email: CLERK,
      displayName: 'Data Entry',
      password: PASSWORD,
      roles: ['data_entry'],
    });
  });

  afterAll(async () => {
    await sql?.unsafe('DELETE FROM users WHERE email IN ($1, $2)', [MANAGER, CLERK]);
    await sql?.end({ timeout: 5 });
    await app?.close();
  });

  // Not async: supertest's chainable request is the return value, so callers
  // can keep using .expect(...) on it.
  function signIn(email: string, password = PASSWORD) {
    return request(app.getHttpServer()).post('/api/auth/sign-in').send({ email, password });
  }

  it('sets a session cookie a script cannot read and another site cannot trigger', async () => {
    const response = await signIn(MANAGER).expect(200);
    const cookie = cookiesFrom(response)[0] ?? '';

    expect(cookie).toContain('amc_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // No Expires or Max-Age: the server's two limits decide, and the client
    // cannot extend what it was never told.
    expect(cookie).not.toContain('Max-Age');
  });

  it('never returns the session secret in the body, only in the cookie', async () => {
    const response = await signIn(MANAGER).expect(200);

    const cookie = cookiesFrom(response)[0] ?? '';
    const token = cookie.slice(cookie.indexOf('=') + 1).split(';')[0] ?? '';
    const secret = decodeURIComponent(token).split('.')[1] ?? '';

    expect(secret.length).toBeGreaterThan(40);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(response.body.caller.displayName).toBe('Wael Ajam');
    expect(response.body.caller.permissions).toContain('users.manage');
    expect(response.body.twoFactorRequired).toBe(false);
  });

  it('answers a wrong password and an unknown address identically', async () => {
    const wrong = await signIn(MANAGER, 'not the password').expect(401);
    const unknown = await signIn('nobody@nowhere.ae').expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('refuses a malformed request in the same words, giving nothing away', async () => {
    const malformed = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email: '', password: '' })
      .expect(401);
    expect(malformed.body.error.message).toBe('Those details are not right');
  });

  it('is closed by default: /auth/me needs a session', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('recognises the caller and reports their permissions', async () => {
    const signedIn = await signIn(MANAGER).expect(200);
    const cookie = cookiesFrom(signedIn);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.roles).toEqual(['manager']);
    expect(me.body.permissions).toContain('users.manage');
  });

  it('gives data entry a working session with no approval powers', async () => {
    const signedIn = await signIn(CLERK).expect(200);
    const cookie = cookiesFrom(signedIn);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.roles).toEqual(['data_entry']);
    expect(me.body.permissions).not.toContain('users.manage');
    expect(me.body.permissions.some((p: string) => p.includes('approve'))).toBe(false);
  });

  it('rejects a forged cookie', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', ['amc_session=01JABCDEF.made-up-secret'])
      .expect(401);
  });

  it('ends the session on sign-out, and the cookie stops working immediately', async () => {
    const signedIn = await signIn(MANAGER).expect(200);
    const cookie = cookiesFrom(signedIn);

    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('keeps the health endpoints reachable without a session', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });
});

describe('two-factor over HTTP', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const email = `twofactor-${Date.now()}@activemanagement.ae`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.NODE_ENV = 'test';

    sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    await app.get(RegisterUser).execute({
      email,
      displayName: 'Two Factor Manager',
      password: PASSWORD,
      roles: ['manager'],
    });
  });

  afterAll(async () => {
    await sql?.unsafe('DELETE FROM users WHERE email = $1', [email]);
    await sql?.end({ timeout: 5 });
    await app?.close();
  });

  function signIn() {
    return request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD });
  }

  it('enrols, confirms with a real time-based code, and then demands one at sign-in', async () => {
    const first = await signIn().expect(200);
    expect(first.body.twoFactorRequired).toBe(false);
    const cookie = cookiesFrom(first);

    const enrolment = await request(app.getHttpServer())
      .post('/api/auth/two-factor/enrol')
      .set('Cookie', cookie)
      .expect(201);
    expect(enrolment.body.uri).toContain('otpauth://totp/');

    // A genuine code, from the implementation proved against the RFC vectors.
    const code = totp(enrolment.body.secret, Date.now());
    await request(app.getHttpServer())
      .post('/api/auth/two-factor/confirm')
      .set('Cookie', cookie)
      .send({ code })
      .expect(204);

    const second = await signIn().expect(200);
    expect(second.body.twoFactorRequired).toBe(true);
  });

  it('locks a half-authenticated session out of everything else', async () => {
    const signedIn = await signIn().expect(200);
    const cookie = cookiesFrom(signedIn);

    // The password alone buys nothing but the verification step.
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/two-factor/enrol')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('refuses a wrong code and accepts the right one', async () => {
    const signedIn = await signIn().expect(200);
    const cookie = cookiesFrom(signedIn);

    await request(app.getHttpServer())
      .post('/api/auth/two-factor/verify')
      .set('Cookie', cookie)
      .send({ code: '000000' })
      .expect(401);

    const [secret] = await sql<{ totp_secret: string }[]>`
      SELECT totp_secret FROM users WHERE email = ${email}
    `;
    const box = new SecretBox(
      process.env.SECRET_ENCRYPTION_KEY ??
        Buffer.alloc(32, 'amc-development-key').toString('base64'),
    );
    const code = totp(box.open(secret?.totp_secret ?? ''), Date.now());

    await request(app.getHttpServer())
      .post('/api/auth/two-factor/verify')
      .set('Cookie', cookie)
      .send({ code })
      .expect(204);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.roles).toEqual(['manager']);
  });

  it('lets a half-authenticated session sign out, so it is not simply stuck', async () => {
    const signedIn = await signIn().expect(200);
    const cookie = cookiesFrom(signedIn);
    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Cookie', cookie).expect(204);
  });

  it('never stores the secret in the clear', async () => {
    const [row] = await sql<{ totp_secret: string }[]>`
      SELECT totp_secret FROM users WHERE email = ${email}
    `;
    expect(row?.totp_secret).toMatch(/^v1\./);
    expect(row?.totp_secret).not.toMatch(/^[A-Z2-7]+$/);
  });
});

describe('the audit trail of a real sign-in', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const email = `audited-${Date.now()}@activemanagement.ae`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.NODE_ENV = 'test';
    sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await sql?.unsafe('DELETE FROM users WHERE email = $1', [email]);
    await sql?.end({ timeout: 5 });
    await app?.close();
  });

  async function entriesFor(userId: string) {
    // Session events are recorded against the session, so the trail is
    // followed by actor as well as by entity.
    return sql<{ action: string; actor_user_id: string | null; entity_id: string }[]>`
      SELECT action, actor_user_id, entity_id FROM audit_log
      WHERE entity_id = ${userId}
         OR actor_user_id = ${userId}
         OR actor_label = ${email}
      ORDER BY occurred_at
    `;
  }

  it('records registration, a failed attempt, a success and a sign-out', async () => {
    const registered = await app.get(RegisterUser).execute({
      email,
      displayName: 'Audited Manager',
      password: PASSWORD,
      roles: ['manager'],
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const userId = registered.value.userId;

    await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: 'the wrong password' })
      .expect(401);

    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = cookiesFrom(signedIn);

    await request(app.getHttpServer()).post('/api/auth/sign-out').set('Cookie', cookie).expect(204);

    const actions = (await entriesFor(userId)).map((row) => row.action);
    expect(actions).toContain('identity.signin.failed');
    expect(actions).toContain('identity.signin.succeeded');
    expect(actions).toContain('identity.session.started');
    expect(actions).toContain('identity.session.revoked');
  });

  it('names the person who signed out, and no one for a failed attempt', async () => {
    const rows = await sql<
      { action: string; actor_user_id: string | null; actor_label: string | null }[]
    >`
      SELECT action, actor_user_id, actor_label FROM audit_log
      WHERE action IN ('identity.signin.failed', 'identity.session.revoked')
        AND (actor_label = ${email} OR actor_user_id IN (SELECT id FROM users WHERE email = ${email}))
      ORDER BY occurred_at
    `;

    const failed = rows.find((row) => row.action === 'identity.signin.failed');
    const revoked = rows.find((row) => row.action === 'identity.session.revoked');

    // Nobody is signed in yet when a password is wrong, so the attempt is
    // recorded against the address rather than attributed to a person.
    expect(failed?.actor_user_id).toBe('anonymous');
    expect(failed?.actor_label).toBe(email);
    expect(revoked?.actor_label).toBe('Audited Manager');
  });

  it('leaves an outbox row for every event, ready to be delivered', async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM outbox WHERE name LIKE 'identity.%'
    `;
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it('records nothing for a sign-in that never happened', async () => {
    const before = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM audit_log`;

    await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email: 'no-such-person@nowhere.ae', password: 'whatever12345' })
      .expect(401);

    const after = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM audit_log`;
    // No user, no aggregate, nothing recorded. The attempt is visible in the
    // logs; inventing an audit row for a person who does not exist would not
    // help anyone.
    expect(after[0]?.count).toBe(before[0]?.count);
  });
});

describe('reading the audit log over HTTP', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const manager = `audit-reader-${Date.now()}@activemanagement.ae`;
  const clerk = `audit-clerk-${Date.now()}@activemanagement.ae`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.NODE_ENV = 'test';
    sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
    await runMigrations(sql, MIGRATIONS_DIRECTORY);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const register = app.get(RegisterUser);
    await register.execute({
      email: manager,
      displayName: 'Audit Reader',
      password: PASSWORD,
      roles: ['manager'],
    });
    await register.execute({
      email: clerk,
      displayName: 'Audit Clerk',
      password: PASSWORD,
      roles: ['data_entry'],
    });
  });

  afterAll(async () => {
    await sql?.unsafe('DELETE FROM users WHERE email IN ($1, $2)', [manager, clerk]);
    await sql?.end({ timeout: 5 });
    await app?.close();
  });

  async function cookieFor(email: string) {
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
    return cookiesFrom(signedIn);
  }

  it('lets the manager read it', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ limit: 5 })
      .set('Cookie', await cookieFor(manager))
      .expect(200);

    expect(Array.isArray(response.body.entries)).toBe(true);
    expect(response.body.entries.length).toBeGreaterThan(0);
  });

  it('refuses data entry, who has no business reading it', async () => {
    await request(app.getHttpServer())
      .get('/api/audit')
      .set('Cookie', await cookieFor(clerk))
      .expect(403);
  });

  it('refuses anyone who is not signed in', async () => {
    await request(app.getHttpServer()).get('/api/audit').expect(401);
  });

  it('filters by action and rejects an unreasonable page size', async () => {
    const cookie = await cookieFor(manager);

    const filtered = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ action: 'identity.session.started', limit: 3 })
      .set('Cookie', cookie)
      .expect(200);
    for (const entry of filtered.body.entries) {
      expect(entry.action).toBe('identity.session.started');
    }

    await request(app.getHttpServer())
      .get('/api/audit')
      .query({ limit: 5000 })
      .set('Cookie', cookie)
      .expect(400);
  });
});
