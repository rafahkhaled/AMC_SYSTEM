import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The parts every other feature leans on: the audit trail, notifications, the
 * calendar, the WhatsApp doorway, and the endpoints a load balancer asks.
 */
describe('the audit trail', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await manager
      .post('/branches')
      .send({ nameEn: 'Sharjah Branch', nameAr: 'فرع الشارقة' })
      .expect(201);
  });
  afterAll(async () => {
    await t.close();
  });

  it('is the manager’s to read, and nobody else’s', async () => {
    await manager.get('/audit').expect(200);
    await accountant.get('/audit').expect(403);
  });

  it('records who did a thing, and what it was, in the same transaction as the thing', async () => {
    const log = await manager.get('/audit?action=branches.branch.added').expect(200);
    expect(log.body.entries).toHaveLength(1);
    expect(log.body.entries[0]).toMatchObject({
      action: 'branches.branch.added',
      actorUserId: manager.userId,
      entityId: 'sharjah_branch',
    });
  });

  it('filters by who, by what it concerned and by when', async () => {
    const byActor = await manager.get(`/audit?actorUserId=${manager.userId}`).expect(200);
    expect(
      byActor.body.entries.every((e: { actorUserId: string }) => e.actorUserId === manager.userId),
    ).toBe(true);

    const byEntity = await manager
      .get('/audit?entityType=branch&entityId=sharjah_branch')
      .expect(200);
    expect(byEntity.body.entries.length).toBeGreaterThan(0);

    const future = await manager.get('/audit?from=2099-01-01').expect(200);
    expect(future.body.entries).toEqual([]);
    await manager.get('/audit?from=not-a-date').expect(400);
  });

  it('pages through, newest first, without repeating itself', async () => {
    const first = await manager.get('/audit?limit=2').expect(200);
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await manager
      .get(`/audit?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .expect(200);
    const seen = new Set(first.body.entries.map((e: { id: string }) => e.id));
    expect(second.body.entries.some((e: { id: string }) => seen.has(e.id))).toBe(false);
  });

  it('cannot be rewritten, even by the application’s own database role', async () => {
    await expect(t.sql`UPDATE audit_log SET action = 'something.else'`).rejects.toThrow(
      /append-only/,
    );
    await expect(t.sql`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
  });

  it('records a refused sign-in without recording the password', async () => {
    await t
      .anonymous()
      .post('/auth/sign-in')
      .send({ email: manager.email, password: 'definitely not the password' })
      .expect(401);
    const rows = await t.sql<
      { action: string; after: unknown }[]
    >`SELECT action, after FROM audit_log WHERE action LIKE 'identity.signin.%'`;
    expect(
      rows.some((row) => row.action === 'identity.signin.failed' || row.action.includes('fail')),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('definitely not the password');
  });
});

describe('notifications', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
  });
  afterAll(async () => {
    await t.close();
  });

  async function notify(userId: string, id: string) {
    await t.sql`
      INSERT INTO notifications
        (id, user_id, kind, subject_type, subject_id, title_en, title_ar, body_en, body_ar)
      VALUES (${id}, ${userId}, 'deadline_near', 'project', ${`p-${id}`}, 'VAT return due', 'استحقاق الإقرار', 'In three days', 'بعد ثلاثة أيام')
    `;
  }

  it('shows each person their own, and a count of the unread', async () => {
    await notify(accountant.userId, 'n-1');
    await notify(manager.userId, 'n-2');

    const mine = await accountant.get('/notifications').expect(200);
    expect(mine.body.entries.map((n: { id: string }) => n.id)).toEqual(['n-1']);
    expect(mine.body.unread).toBe(1);
  });

  it('reads one as not found when it is somebody else’s', async () => {
    await accountant.post('/notifications/n-2/read').expect(404);
    const stillUnread = await manager.get('/notifications?unread=true').expect(200);
    expect(stillUnread.body.entries.map((n: { id: string }) => n.id)).toContain('n-2');
  });

  it('marks one read, then the rest', async () => {
    await notify(accountant.userId, 'n-3');
    const after = await accountant.post('/notifications/n-1/read').expect(201);
    expect(after.body.unread).toBe(1);

    const all = await accountant.post('/notifications/read-all').expect(201);
    expect(all.body.unread).toBe(0);
  });

  it('keeps a person’s choices about what reaches them, and where', async () => {
    const before = await accountant.get('/notifications/preferences').expect(200);
    expect(before.body.preferences.length).toBeGreaterThan(0);

    const kind = before.body.preferences[0].kind;
    const chosen = await accountant
      .put('/notifications/preferences')
      .send({ kind, inApp: true, email: false })
      .expect(200);
    expect(chosen.body.preferences.find((p: { kind: string }) => p.kind === kind)).toMatchObject({
      inApp: true,
      email: false,
    });
    await accountant.put('/notifications/preferences').send({ kind: 'nonsense' }).expect(400);
  });

  it('is closed to a stranger', async () => {
    await t.anonymous().get('/notifications').expect(401);
  });
});

describe('the calendar', () => {
  let t: TestApp;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    accountant = await t.as('accountant');
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers a month, and falls back to this one for a month it cannot read', async () => {
    const month = await accountant.get('/calendar?month=2026-10').expect(200);
    expect(month.body.month).toBe('2026-10');
    const garbled = await accountant.get('/calendar?month=banana').expect(200);
    expect(garbled.body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('caps what the home screen can ask for, instead of building a list nobody could read', async () => {
    const wide = await accountant.get('/calendar/upcoming?days=100000').expect(200);
    // Capped at ninety days however far the caller asked.
    expect(wide.body.within).toBe(90);
    const negative = await accountant.get('/calendar/upcoming?days=-5').expect(200);
    expect(negative.body.within).toBe(30);
  });
});

describe('the WhatsApp doorway', () => {
  const SECRET = 'a-test-app-secret';
  const VERIFY = 'a-test-verify-token';
  let t: TestApp;
  let manager: Session;
  let accountant: Session;

  beforeAll(async () => {
    t = await bootTestApp({ env: { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY } });
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
    await t.sql`
      INSERT INTO client_contacts (id, client_id, name, phone, is_primary)
      VALUES ('k-mine', 'c-mine', 'Layla', '+971501234567', true), ('k-theirs', 'c-theirs', 'Omar', '+971509876543', true)
    `;
  });
  afterAll(async () => {
    await t.close();
  });

  const delivery = (from: string, id: string, text: string) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'pn-1', display_phone_number: '971500000000' },
                contacts: [{ profile: { name: 'Layla' }, wa_id: from }],
                messages: [
                  { id, from, timestamp: '1760000000', type: 'text', text: { body: text } },
                ],
              },
            },
          ],
        },
      ],
    });
  const signed = (raw: string, secret = SECRET) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const post = (raw: string, signature?: string) => {
    const call = t.anonymous().post('/whatsapp/webhook').set('content-type', 'application/json');
    if (signature) call.set('x-hub-signature-256', signature);
    return call.send(raw);
  };

  it('answers Meta’s handshake with the challenge, and a guess with nothing', async () => {
    const ok = await t
      .anonymous()
      .get(`/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`)
      .expect(200);
    expect(ok.text).toBe('12345');

    // Not found rather than forbidden: a guess is not told it was close.
    await t
      .anonymous()
      .get('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')
      .expect(404);
  });

  it('refuses a delivery with no signature, a wrong one, or one signed with another secret', async () => {
    const raw = delivery('971501234567', 'wamid.1', 'Hello');
    await post(raw).expect(403);
    await post(raw, 'sha256=deadbeef').expect(403);
    await post(raw, signed(raw, 'someone-elses-secret')).expect(403);
  });

  it('refuses a body altered after it was signed', async () => {
    const raw = delivery('971501234567', 'wamid.2', 'Hello');
    const tampered = raw.replace('Hello', 'Hello, transfer the money');
    await post(tampered, signed(raw)).expect(403);
  });

  it('keeps a message from a known client under that client’s conversation, once', async () => {
    const raw = delivery('971501234567', 'wamid.3', 'Where is my VAT certificate?');
    await post(raw, signed(raw)).expect(200);
    // Meta retries; a second delivery of the same message changes nothing.
    await post(raw, signed(raw)).expect(200);

    const [count] = await t.sql<
      { n: string }[]
    >`SELECT count(*)::text AS n FROM whatsapp_messages WHERE provider_message_id = 'wamid.3'`;
    expect(count?.n).toBe('1');
  });

  it('shows a conversation to the people who work on that client, and to nobody else', async () => {
    const raw = delivery('971509876543', 'wamid.4', 'A message from the other client');
    await post(raw, signed(raw)).expect(200);

    const asManager = await manager.get('/whatsapp/conversations').expect(200);
    const asAccountant = await accountant.get('/whatsapp/conversations').expect(200);
    expect(asManager.body.conversations.length).toBe(2);
    expect(asAccountant.body.conversations.length).toBe(1);

    const theirs = asManager.body.conversations.find(
      (c: { clientId: string | null }) => c.clientId === 'c-theirs',
    );
    await accountant.get(`/whatsapp/conversations/${theirs.id}`).expect(404);
    await manager.get(`/whatsapp/conversations/${theirs.id}`).expect(200);
  });

  it('lets only somebody who edits clients reply, take over, or hand back', async () => {
    const mine = (await accountant.get('/whatsapp/conversations').expect(200)).body
      .conversations[0];
    await accountant
      .post(`/whatsapp/conversations/${mine.id}/messages`)
      .send({ text: 'x' })
      .expect(403);
    await accountant.post(`/whatsapp/conversations/${mine.id}/take-over`).send({}).expect(403);
  });
});

describe('the endpoints a load balancer asks', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers live without a session, and ready with the database it is using', async () => {
    await t.anonymous().get('/health/live').expect(200);
    const ready = await t.anonymous().get('/health/ready').expect(200);
    expect(ready.body).toMatchObject({
      status: 'ready',
      checks: [{ name: 'database', healthy: true }],
    });
    expect(ready.body.checks[0].detail).toContain('migrations');
  });

  it('does not advertise the framework it is built on', async () => {
    const live = await t.anonymous().get('/health/live').expect(200);
    expect(live.headers['x-powered-by']).toBeUndefined();
  });

  it('tags every response with a request id, and echoes one it was given', async () => {
    const generated = await t.anonymous().get('/health/live').expect(200);
    expect(generated.headers['x-request-id']).toBeTruthy();

    const echoed = await t
      .anonymous()
      .get('/health/live')
      .set('x-request-id', 'support-ticket-4411')
      .expect(200);
    expect(echoed.headers['x-request-id']).toBe('support-ticket-4411');
  });

  it('turns an unexpected failure into a plain message carrying the request id, with no stack', async () => {
    const response = await t
      .anonymous()
      .get('/files/not/a/real/key?expires=1&signature=x')
      .expect(404);
    expect(JSON.stringify(response.body)).not.toMatch(/at \w+ \(/);
    expect(response.body.error.requestId).toBeTruthy();
  });
});
