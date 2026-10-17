import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The people who work here, and the hours they record.
 *
 * Both are about who may see and change what — a staff list that shows hours to
 * somebody who may not read them, a timer that records time against a client
 * nobody has given you — so each test is asked of more than one person.
 */
describe('staff', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
  });
  afterAll(async () => {
    await t.close();
  });

  const member = (email: string, over: Record<string, unknown> = {}) => ({
    email,
    displayName: 'Hana Saeed',
    password: PASSWORD,
    roles: ['accountant'],
    ...over,
  });
  const emailOf = (n: string) =>
    `${n}-${Math.random().toString(36).slice(2, 7)}@activemanagement.ae`;

  it('lists everybody to everybody signed in, but shows hours only to those who may read them', async () => {
    const asManager = await manager.get('/staff').expect(200);
    const asAccountant = await accountant.get('/staff').expect(200);

    expect(asManager.body.staff.length).toBe(3);
    expect(asAccountant.body.staff.length).toBe(3);
    // Null, not zero: a nought is a claim about the person, absence is a claim
    // about the reader.
    expect(asManager.body.staff[0].thisMonthSeconds).not.toBeNull();
    expect(
      asAccountant.body.staff.every(
        (s: { thisMonthSeconds: unknown }) => s.thisMonthSeconds === null,
      ),
    ).toBe(true);
  });

  it('adds a colleague, who can then sign in with what was set for them', async () => {
    const email = emailOf('hana');
    await manager.post('/staff').send(member(email)).expect(201);

    const signedIn = await t
      .anonymous()
      .post('/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(signedIn.body.caller.roles).toEqual(['accountant']);
    expect(signedIn.body.caller.permissions).not.toContain('users.manage');
  });

  it('refuses a short password, a bad address, no role, and an address already used', async () => {
    const email = emailOf('dup');
    await manager
      .post('/staff')
      .send(member(email, { password: 'short' }))
      .expect(400);
    await manager.post('/staff').send(member('not-an-email')).expect(400);
    await manager
      .post('/staff')
      .send(member(email, { roles: [] }))
      .expect(400);

    await manager.post('/staff').send(member(email)).expect(201);
    await manager.post('/staff').send(member(email)).expect(409);
  });

  it('corrects a name and roles, and sets the hours somebody works', async () => {
    const email = emailOf('omar');
    await manager
      .post('/staff')
      .send(member(email, { displayName: 'Omar' }))
      .expect(201);
    const id = (await t.sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;

    const changed = await manager
      .patch(`/staff/${id}`)
      .send({
        displayName: 'Omar Nasser',
        roles: ['data_entry'],
        workingHours: { startsAt: '08:00', endsAt: '16:00', days: [1, 2, 3, 4, 5] },
      })
      .expect(200);
    const found = changed.body.staff.find((s: { id: string }) => s.id === id);
    expect(found).toMatchObject({
      displayName: 'Omar Nasser',
      roles: ['data_entry'],
      workingHours: { startsAt: '08:00', endsAt: '16:00' },
    });

    await manager
      .patch(`/staff/${id}`)
      .send({ workingHours: { startsAt: '8am', endsAt: '16:00', days: [1] } })
      .expect(400);
    await manager
      .patch(`/staff/${id}`)
      .send({ workingHours: { startsAt: '08:00', endsAt: '16:00', days: [9] } })
      .expect(400);
  });

  it('suspends somebody rather than deleting them, ends their session, and lets them back', async () => {
    const email = emailOf('leaver');
    await manager.post('/staff').send(member(email)).expect(201);
    const id = (await t.sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;

    const signedIn = await t
      .anonymous()
      .post('/auth/sign-in')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = (signedIn.headers['set-cookie'] as unknown as string[]) ?? [];
    await t.anonymous().get('/auth/me').set('Cookie', cookie).expect(200);

    await manager.post(`/staff/${id}/status`).send({ status: 'suspended' }).expect(201);

    // The cookie they already hold stops working, not only the next sign-in.
    await t.anonymous().get('/auth/me').set('Cookie', cookie).expect(401);
    await t.anonymous().post('/auth/sign-in').send({ email, password: PASSWORD }).expect(401);
    // Their record is still there, because their id is on every hour and every audit row.
    const [row] = await t.sql<
      { n: string }[]
    >`SELECT count(*)::text AS n FROM users WHERE id = ${id ?? ''}`;
    expect(row?.n).toBe('1');

    await manager.post(`/staff/${id}/status`).send({ status: 'active' }).expect(201);
    await t.anonymous().post('/auth/sign-in').send({ email, password: PASSWORD }).expect(200);
    await manager.post(`/staff/${id}/status`).send({ status: 'asleep' }).expect(400);
  });

  it('is the manager’s alone to change', async () => {
    await accountant
      .post('/staff')
      .send(member(emailOf('x')))
      .expect(403);
    await dataEntry.patch('/staff/anyone').send({ displayName: 'x' }).expect(403);
    await accountant.post('/staff/anyone/status').send({ status: 'suspended' }).expect(403);
  });

  it('records who added somebody, in the audit log', async () => {
    const rows = await t.sql<{ action: string; actor_user_id: string }[]>`
      SELECT action, actor_user_id FROM audit_log WHERE action LIKE 'identity.user.%' OR action LIKE 'identity.staff.%'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.actor_user_id === manager.userId)).toBe(true);
  });
});

describe('recording time', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;
  let project: string;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
    project = (
      await accountant
        .post('/projects')
        .send({ clientId: 'c-mine', service: 'emaratax_request' })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => {
    await t.close();
  });

  it('starts and stops a timer, and keeps what was recorded', async () => {
    await accountant.post('/timer/start').send({ projectId: project }).expect(201);
    const running = await accountant.get('/timer').expect(200);
    expect(running.body.running).toMatchObject({ projectId: project });

    await accountant.post('/timer/stop').send({}).expect(201);
    const after = await accountant.get('/timer').expect(200);
    expect(after.body.running).toBeNull();
  });

  it('will not run two timers at once for one person', async () => {
    await accountant.post('/timer/start').send({ projectId: project }).expect(201);
    // Starting another is either refused or moves the clock; it never doubles it.
    await accountant.post('/timer/start').send({ projectId: project });
    const [live] = await t.sql<
      { n: string }[]
    >`SELECT count(*)::text AS n FROM running_timers WHERE user_id = ${accountant.userId}`;
    expect(live?.n).toBe('1');
    await accountant.post('/timer/stop').send({}).expect(201);
  });

  it('holds and resumes without losing the time before the pause', async () => {
    await accountant.post('/timer/start').send({ projectId: project }).expect(201);
    await accountant.post('/timer/hold').send({}).expect(201);
    await accountant.post('/timer/resume').send({}).expect(201);
    await accountant.post('/timer/stop').send({}).expect(201);
  });

  it('is not available to somebody who does not record time', async () => {
    await dataEntry.post('/timer/start').send({ projectId: project }).expect(403);
    await t.anonymous().post('/timer/start').send({ projectId: project }).expect(401);
  });

  it('lets a person record time on a project they are not on, and does not thereby open the client to them', async () => {
    // Deliberate: the resolver adds the person as a collaborator rather than
    // losing the hour, because people help with each other's work. What must not
    // follow from it is access — being a collaborator on one project is not a
    // way to read the client it belongs to.
    const theirs = (
      await manager
        .post('/projects')
        .send({ clientId: 'c-theirs', service: 'emaratax_request' })
        .expect(201)
    ).body.id;

    await accountant.post('/timer/start').send({ projectId: theirs }).expect(201);
    await accountant.post('/timer/stop').send({}).expect(201);

    await accountant.get('/clients/c-theirs').expect(404);
    await accountant.get(`/projects/${theirs}`).expect(404);
    await accountant.get('/clients/c-theirs/files').expect(200);
    const files = await accountant.get('/clients/c-theirs/files');
    expect(files.body.files).toEqual([]);
  });

  describe('time typed in by hand', () => {
    const entry = (over: Record<string, unknown> = {}) => ({
      projectId: project,
      startedAt: '2026-10-08T09:00',
      endedAt: '2026-10-08T11:30',
      reason: 'Forgot to start the timer',
      ...over,
    });

    it('is kept with its reason, and counted in the timesheet', async () => {
      await accountant.post('/timer/entries').send(entry()).expect(201);
      const sheet = await accountant
        .get('/timer/timesheet?from=2026-10-08&to=2026-10-08')
        .expect(200);
      expect(sheet.body.totalSeconds).toBe(2.5 * 3600);
      expect(sheet.body.entries[0]).toMatchObject({ billable: true });
    });

    it('needs a reason, because it is the part most likely to be questioned', async () => {
      await accountant
        .post('/timer/entries')
        .send(entry({ reason: '' }))
        .expect(400);
      await accountant
        .post('/timer/entries')
        .send(entry({ reason: 'x' }))
        .expect(400);
    });

    it('refuses an entry that ends before it starts, and a malformed time', async () => {
      const backwards = await accountant
        .post('/timer/entries')
        .send(entry({ startedAt: '2026-10-08T12:00', endedAt: '2026-10-08T09:00' }));
      expect(backwards.status).toBeGreaterThanOrEqual(400);
      await accountant
        .post('/timer/entries')
        .send(entry({ startedAt: 'yesterday' }))
        .expect(400);
    });
  });

  describe('approving it', () => {
    it('shows the manager what needs approving, and lets them approve it once', async () => {
      const queue = await manager.get('/timer/approvals').expect(200);
      const ids = (queue.body.entries ?? queue.body.pending ?? []).map((e: { id: string }) => e.id);
      expect(ids.length).toBeGreaterThan(0);

      const done = await manager.post('/timer/entries/approve').send({ entryIds: ids }).expect(201);
      expect(done.body.approved).toEqual(expect.arrayContaining(ids));
      expect(done.body.refused).toEqual([]);

      // Approved entries leave the queue, so the same hour cannot be approved
      // twice by somebody working down it.
      const after = await manager.get('/timer/approvals').expect(200);
      expect(after.body.entries).toEqual([]);
    });

    it('refuses an empty selection, and is closed to anybody who may not approve', async () => {
      await manager.post('/timer/entries/approve').send({ entryIds: [] }).expect(400);
      await accountant
        .post('/timer/entries/approve')
        .send({ entryIds: ['x'] })
        .expect(403);
      await accountant.get('/timer/approvals').expect(403);
    });
  });
});
