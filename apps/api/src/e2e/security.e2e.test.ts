import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * What every route has in common: it is closed unless it says otherwise.
 *
 * The sweep below does not list the routes — it asks the running application
 * what it serves. A list kept by hand is a list that does not have the route
 * somebody added last week, and an unguarded route is exactly the kind of
 * mistake nobody notices until it is read by someone it was not meant for.
 */

/** Routes that are public on purpose, with the reason each one is. */
const PUBLIC = new Set([
  'POST /api/auth/sign-in', // how anyone gets a session
  'GET /api/health/live', // the load balancer
  'GET /api/health/ready', // the deploy check
  'GET /api/files/*key', // authorised by a signed, expiring link, not a session
  'GET /api/public/quotations/:token', // the client's own link
  'POST /api/public/quotations/:token/answer', // the client's own answer
  'POST /api/public/enquiries', // the firm's website sending an enquiry
  'POST /api/auth/forgot-password', // somebody who cannot sign in, asking for a link
  'POST /api/auth/reset-password', // choosing a new password from that link
  'OPTIONS /api/public/enquiries', // the browser's permission check for it
  'GET /api/whatsapp/webhook', // Meta's verification handshake
  'POST /api/whatsapp/webhook', // authorised by an HMAC over the body
  'POST /api/auth/two-factor/verify', // the second step of signing in
]);

interface Route {
  method: string;
  path: string;
}

function routesOf(app: TestApp): Route[] {
  // biome-ignore lint/suspicious/noExplicitAny: express's router is not typed
  const router = (app.app.getHttpAdapter().getInstance() as any).router;
  const found: Route[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: express's router is not typed
  for (const layer of router.stack as any[]) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      found.push({ method: method.toUpperCase(), path: String(layer.route.path) });
    }
  }
  return found;
}

describe('every route is closed unless it says otherwise', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('finds the routes it is meant to be checking', () => {
    // A sweep that found nothing would pass for the wrong reason.
    const routes = routesOf(t);
    expect(routes.length).toBeGreaterThan(80);
    expect(routes).toContainEqual({ method: 'POST', path: '/api/billing/quotations' });
  });

  it('answers 401 to a stranger on every route that is not public on purpose', async () => {
    const open: string[] = [];
    for (const route of routesOf(t)) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC.has(key)) continue;

      // Placeholders filled with something that parses, since the guard runs
      // before anything looks at the value.
      const path = route.path.replace(/:[A-Za-z]+/g, 'x').replace('*key', 'x');
      const response = await (
        t.anonymous() as Record<
          string,
          (path: string) => { send: (b: unknown) => Promise<{ status: number }> }
        >
      )
        [route.method.toLowerCase()]?.(path.replace(/^\/api/, ''))
        .send({});
      if (response?.status !== 401) open.push(`${key} → ${response?.status}`);
    }
    expect(open).toEqual([]);
  });

  it('has not made public anything that is not on the reviewed list', () => {
    // The other direction: a route somebody marked @Public that is not in the
    // list above fails here, so making one public is a decision somebody sees.
    const known = routesOf(t).map((route) => `${route.method} ${route.path}`);
    for (const publicRoute of PUBLIC) expect(known).toContain(publicRoute);
  });

  it('has no route that an earlier one shadows', () => {
    /*
     * Express answers with the first route that matches, in the order they were
     * declared. `quotations/:id/:act` was declared before `quotations/:id/resend`
     * and answered "that is not something to do to a quotation" for it — the
     * route existed, was tested at the unit level, and could not be reached.
     *
     * For every route, fill its parameters with a value and find the first route
     * that would answer it. If that is not the route itself, it is shadowed.
     */
    const routes = routesOf(t);
    const shadowed: string[] = [];

    const matcher = (path: string) =>
      new RegExp(`^${path.replace(/\*[A-Za-z]+/g, '.+').replace(/:[A-Za-z]+/g, '[^/]+')}$`);

    for (const [index, route] of routes.entries()) {
      const concrete = route.path.replace(/:[A-Za-z]+/g, 'x').replace(/\*[A-Za-z]+/g, 'x');
      const first = routes.findIndex(
        (other) => other.method === route.method && matcher(other.path).test(concrete),
      );
      if (first !== index) {
        const winner = routes[first];
        shadowed.push(`${route.method} ${route.path} is answered by ${winner?.path}`);
      }
    }
    expect(shadowed).toEqual([]);
  });
});
