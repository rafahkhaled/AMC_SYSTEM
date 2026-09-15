import 'reflect-metadata';
import { MIGRATIONS_DIRECTORY, runMigrations } from '@amc/database';
import { RegisterUser } from '@amc/identity';
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
    return request(app.getHttpServer()).post('/auth/sign-in').send({ email, password });
  }

  it('sets a session cookie a script cannot read and another site cannot trigger', async () => {
    const response = await signIn(MANAGER).expect(200);
    const cookie = response.headers['set-cookie']?.[0] ?? '';

    expect(cookie).toContain('amc_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // No Expires or Max-Age: the server's two limits decide, and the client
    // cannot extend what it was never told.
    expect(cookie).not.toContain('Max-Age');
  });

  it('never returns the session secret in the body, only in the cookie', async () => {
    const response = await signIn(MANAGER).expect(200);

    const cookie = response.headers['set-cookie']?.[0] ?? '';
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
      .post('/auth/sign-in')
      .send({ email: '', password: '' })
      .expect(401);
    expect(malformed.body.error.message).toBe('Those details are not right');
  });

  it('is closed by default: /auth/me needs a session', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('recognises the caller and reports their permissions', async () => {
    const signedIn = await signIn(MANAGER).expect(200);
    const cookie = signedIn.headers['set-cookie'] ?? [];

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.roles).toEqual(['manager']);
    expect(me.body.permissions).toContain('users.manage');
  });

  it('gives data entry a working session with no approval powers', async () => {
    const signedIn = await signIn(CLERK).expect(200);
    const cookie = signedIn.headers['set-cookie'] ?? [];

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.roles).toEqual(['data_entry']);
    expect(me.body.permissions).not.toContain('users.manage');
    expect(me.body.permissions.some((p: string) => p.includes('approve'))).toBe(false);
  });

  it('rejects a forged cookie', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', ['amc_session=01JABCDEF.made-up-secret'])
      .expect(401);
  });

  it('ends the session on sign-out, and the cookie stops working immediately', async () => {
    const signedIn = await signIn(MANAGER).expect(200);
    const cookie = signedIn.headers['set-cookie'] ?? [];

    await request(app.getHttpServer()).post('/auth/sign-out').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('keeps the health endpoints reachable without a session', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
});
