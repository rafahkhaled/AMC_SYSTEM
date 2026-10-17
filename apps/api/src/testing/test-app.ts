import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIRECTORY, runMigrations } from '@amc/database';
import { RegisterUser } from '@amc/identity';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { APPLICATION_OPTIONS, configureApp } from '../http/configure-app.js';

/**
 * A real copy of the API, for tests that go in through the front door.
 *
 * The unit tests prove the rules and the integration tests prove the SQL; what
 * neither proves is that the route exists, is guarded by the right permission,
 * parses its body the way the browser sends it and answers in the shape the
 * screen reads. Every defect found in the last week that passed its tests lived
 * in exactly that gap.
 *
 * Each suite gets its own database, created from nothing and dropped at the
 * end. The shared test database is for tests that roll back; these commit, as
 * the real thing does, and committing into a database other suites are reading
 * would make both flaky.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://amc@127.0.0.1:5433/amc_test';

export const PASSWORD = 'correct horse battery staple';

export type RoleName = 'manager' | 'accountant' | 'data_entry';

export interface Session {
  readonly userId: string;
  readonly email: string;
  get(path: string): request.Test;
  post(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
}

export interface TestApp {
  readonly app: INestApplication;
  /** A raw connection to this suite's own database. */
  readonly sql: postgres.Sql;
  /** Not signed in. */
  anonymous(): Pick<Session, 'get' | 'post' | 'patch' | 'put' | 'delete'>;
  /** Registers (once) and signs in somebody holding the role. */
  as(role: RoleName): Promise<Session>;
  /** A fresh person with the role, for tests that need two of the same. */
  another(role: RoleName, label: string): Promise<Session>;
  /** Inserts a client and, optionally, assigns an accountant to it. */
  client(id: string, name: string, options?: { assignTo?: Session[] }): Promise<void>;
  close(): Promise<void>;
}

export async function bootTestApp(
  options: { trustProxyHops?: number; env?: Record<string, string> } = {},
): Promise<TestApp> {
  const database = `amc_e2e_${randomBytes(5).toString('hex')}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${database}`);

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await runMigrations(sql, MIGRATIONS_DIRECTORY);

  const storage = mkdtempSync(join(tmpdir(), 'amc-e2e-'));
  const saved = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'local',
    STORAGE_ROOT: storage,
    // Five percent, as the firm is registered.
    BILLING_VAT_BASIS_POINTS: '500',
    TRUST_PROXY_HOPS: String(options.trustProxyHops ?? 0),
    ...options.env,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication(APPLICATION_OPTIONS);
  configureApp(app, { trustProxyHops: options.trustProxyHops ?? 0 });
  await app.init();
  const server = app.getHttpServer();
  const register = app.get(RegisterUser);

  const cookiesOf = (response: { headers: Record<string, unknown> }): string[] => {
    const header = response.headers['set-cookie'];
    return Array.isArray(header)
      ? (header as string[])
      : typeof header === 'string'
        ? [header]
        : [];
  };

  const people = new Map<string, Session>();

  async function create(role: RoleName, label: string): Promise<Session> {
    const email = `${label}-${randomBytes(3).toString('hex')}@activemanagement.ae`;
    await register.execute({
      email,
      displayName: `${label} (${role})`,
      password: PASSWORD,
      roles: [role],
    });
    const signedIn = await request(server)
      .post('/api/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = cookiesOf(signedIn);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;

    return {
      userId: row?.id ?? '',
      email,
      get: (path) => request(server).get(`/api${path}`).set('Cookie', cookie),
      post: (path) => request(server).post(`/api${path}`).set('Cookie', cookie),
      patch: (path) => request(server).patch(`/api${path}`).set('Cookie', cookie),
      put: (path) => request(server).put(`/api${path}`).set('Cookie', cookie),
      delete: (path) => request(server).delete(`/api${path}`).set('Cookie', cookie),
    };
  }

  return {
    app,
    sql,
    anonymous: () => ({
      get: (path) => request(server).get(`/api${path}`),
      post: (path) => request(server).post(`/api${path}`),
      patch: (path) => request(server).patch(`/api${path}`),
      put: (path) => request(server).put(`/api${path}`),
      delete: (path) => request(server).delete(`/api${path}`),
    }),
    async as(role) {
      const known = people.get(role);
      if (known) return known;
      const made = await create(role, role);
      people.set(role, made);
      return made;
    },
    another: (role, label) => create(role, label),
    async client(id, name, assign: { assignTo?: Session[] } = {}) {
      await sql`INSERT INTO clients (id, legal_name, status) VALUES (${id}, ${name}, 'active')`;
      for (const person of assign.assignTo ?? []) {
        await sql`
          INSERT INTO client_staff_access (client_id, user_id, assigned_by)
          VALUES (${id}, ${person.userId}, ${person.userId})
        `;
      }
    },
    async close() {
      await app.close();
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      rmSync(storage, { recursive: true, force: true });
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    },
  };
}
