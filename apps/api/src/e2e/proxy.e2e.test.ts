import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { PASSWORD, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Where an action came from, as the audit log records it.
 *
 * In production every row said the same internal address: the API sits behind
 * a proxy, every connection arrives from the proxy, and nothing told Express to
 * look at what the proxy forwarded. The trail could say who did something and
 * not where from. Trusting the forwarded address fixes that — and trusting it
 * blindly lets anybody write whatever address they like into the trail with a
 * header, so what is believed is exactly as many hops as there are proxies.
 */
async function signInWith(t: TestApp, forwarded?: string): Promise<string | null> {
  const email = `proxy-${Math.random().toString(36).slice(2, 8)}@activemanagement.ae`;
  await t.sql`SELECT 1`; // the pool is warm
  const { RegisterUser } = await import('@amc/identity');
  await t.app.get(RegisterUser).execute({
    email,
    displayName: 'Proxy Test',
    password: PASSWORD,
    roles: ['accountant'],
  });

  const call = request(t.app.getHttpServer()).post('/api/auth/sign-in');
  if (forwarded) call.set('X-Forwarded-For', forwarded);
  await call.send({ email, password: PASSWORD }).expect(200);

  const [row] = await t.sql<{ ip_address: string | null }[]>`
    SELECT ip_address FROM audit_log
    WHERE actor_user_id = (SELECT id FROM users WHERE email = ${email})
    ORDER BY occurred_at DESC LIMIT 1
  `;
  return row?.ip_address ?? null;
}

describe('behind one proxy, as in production', () => {
  let t: TestApp;
  afterAll(async () => {
    await t?.close();
  });

  it('records the address the proxy forwarded, not the proxy’s own', async () => {
    t = await bootTestApp({ trustProxyHops: 1 });
    expect(await signInWith(t, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('is not fooled by addresses the caller put in front of the real one', async () => {
    // The proxy appends the address it saw to whatever the caller sent, so the
    // one to believe is the last. A caller claiming to be somebody else only
    // fills in the part that is ignored.
    expect(await signInWith(t, '10.0.0.1, 198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
  });
});

describe('with no proxy in front, as on a development machine', () => {
  let t: TestApp;
  afterAll(async () => {
    await t?.close();
  });

  it('ignores the header altogether, because anybody can send it', async () => {
    t = await bootTestApp({ trustProxyHops: 0 });
    const recorded = await signInWith(t, '203.0.113.7');

    expect(recorded).not.toBe('203.0.113.7');
    // Whatever the socket said: loopback, in one of its two spellings.
    expect(recorded).toMatch(/(127\.0\.0\.1|::1)$/);
  });
});
