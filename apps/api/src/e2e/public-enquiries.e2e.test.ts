import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The firm's website sending an enquiry into the CRM.
 *
 * The one route anybody on the internet may write through, so what it refuses
 * matters as much as what it accepts: another website, a bot, a flood, and a
 * form with nothing in it.
 */
describe('website enquiries', () => {
  let t: TestApp;
  let manager: Session;

  const SITE = 'https://preview.activemc.ae';
  const enquiry = {
    name: 'Mariam Al Suwaidi',
    company: 'Gulf Trading LLC',
    email: 'mariam@gulf.example',
    phone: '050 123 4567',
    service: 'Accounting and Bookkeeping',
    message: 'We need monthly bookkeeping and a VAT return.',
    page: '/',
  };
  const post = (body: unknown, origin: string | null = SITE) => {
    const request = t.anonymous().post('/public/enquiries');
    if (origin) request.set('Origin', origin);
    return request.send(body as object);
  };
  const leads = async () =>
    t.sql<
      {
        name: string;
        source: string;
        email: string;
        notes: string | null;
        source_detail: string | null;
        requested_service: string | null;
        status: string;
      }[]
    >`
      SELECT name, source, email, notes, source_detail, requested_service, status FROM leads ORDER BY received_at
    `;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers the browser’s permission check for the firm’s website, and only for it', async () => {
    const ok = await t
      .anonymous()
      .options('/public/enquiries')
      .set('Origin', SITE)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe(SITE);
    expect(ok.headers['access-control-allow-methods']).toContain('POST');
    expect(ok.headers.vary).toContain('Origin');
    // No cookies are involved, so none are allowed to be.
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    await t
      .anonymous()
      .options('/public/enquiries')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('records a visitor’s request as a lead from the website, with what they wrote', async () => {
    const response = await post(enquiry).expect(201);
    expect(response.body).toEqual({ received: true });
    expect(response.headers['access-control-allow-origin']).toBe(SITE);
    expect(response.headers['set-cookie']).toBeUndefined();

    const [lead] = await leads();
    expect(lead).toMatchObject({
      name: 'Mariam Al Suwaidi',
      source: 'website',
      email: 'mariam@gulf.example',
      status: 'new',
      requested_service: 'Accounting and Bookkeeping',
      source_detail: 'Website /',
    });
    expect(lead?.notes).toContain('Gulf Trading LLC');
    expect(lead?.notes).toContain('monthly bookkeeping');
  });

  it('shows up on the leads board for staff, labelled as from the website', async () => {
    const board = await manager.get('/leads').expect(200);
    const found = board.body.columns
      .flatMap((c: { leads: { name: string; source: string }[] }) => c.leads)
      .find((l: { name: string }) => l.name === 'Mariam Al Suwaidi');
    expect(found).toMatchObject({ source: 'website' });
  });

  it('writes the enquiry to the audit log as the website, with the visitor’s address', async () => {
    const rows = await t.sql<{ actor_label: string | null; ip_address: string | null }[]>`
      SELECT actor_label, ip_address FROM audit_log WHERE action = 'clients.lead.captured'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.actor_label).toBe('Website enquiry');
    expect(rows[0]?.ip_address).toBeTruthy();
  });

  it('works with only a name and an email', async () => {
    await post({ name: 'Noor', email: 'noor@clinic.example' }).expect(201);
    expect((await leads()).map((l) => l.name)).toContain('Noor');
  });

  it('refuses a form with no name, no email, or an email that is not one', async () => {
    const before = (await leads()).length;
    await post({ ...enquiry, name: '' }).expect(400);
    await post({ ...enquiry, email: '' }).expect(400);
    await post({ ...enquiry, email: 'not an email' }).expect(400);
    await post({ ...enquiry, message: 'x'.repeat(2001) }).expect(400);
    await post({}).expect(400);
    expect((await leads()).length).toBe(before);
  });

  it('refuses another website, and a request that says nothing about where it came from', async () => {
    const before = (await leads()).length;
    await post(enquiry, 'https://evil.example').expect(403);
    await post(enquiry, null).expect(403);
    expect((await leads()).length).toBe(before);
  });

  it('tells a bot it worked and records nothing', async () => {
    const before = (await leads()).length;
    const caught = await post({ ...enquiry, name: 'Bot', website: 'http://spam.example' }).expect(
      201,
    );
    expect(caught.body).toEqual({ received: true });
    expect((await leads()).length).toBe(before);
  });

  it('stops one address after a handful, and says to try later', async () => {
    let refused = 0;
    for (let i = 0; i < 8; i += 1) {
      const response = await post({ ...enquiry, name: `Flood ${i}` });
      if (response.status === 429) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
    const limited = await post(enquiry).expect(429);
    expect(limited.body.error.message).toContain('try again later');
  });

  it('is not a way to read anything', async () => {
    await t.anonymous().get('/public/enquiries').set('Origin', SITE).expect(404);
    await t.anonymous().get('/leads').expect(401);
  });
});
