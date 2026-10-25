import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * What each role may do, chosen by the firm.
 *
 * The point of the screen is that a change is felt at once, by everybody in
 * the role, without signing anybody out. So every test here makes a change and
 * then uses it as somebody holding that role.
 */
describe('roles and permissions', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;

  const choose = (role: string, permissions: string[]) =>
    manager.put(`/roles/${role}/permissions`).send({ permissions });
  const roleOf = (body: { roles: { role: string; permissions: string[] }[] }, role: string) =>
    body.roles.find((one) => one.role === role);

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('shows the manager every role, what it may do, and which can be changed', async () => {
    const response = await manager.get('/roles').expect(200);
    expect(roleOf(response.body, 'manager')).toMatchObject({ editable: false });
    expect(roleOf(response.body, 'accountant')).toMatchObject({ editable: true });
    expect(roleOf(response.body, 'data_entry')).toMatchObject({ editable: true });
    expect(response.body.grantable).toContain('clients.edit');
    expect(response.body.grantable).not.toContain('users.manage');
    // The defaults from the requirements, to start with.
    expect(roleOf(response.body, 'accountant')?.permissions).toContain('billing.view');
    expect(roleOf(response.body, 'accountant')?.permissions).not.toContain('clients.edit');
  });

  it('is the manager’s screen only', async () => {
    await accountant.get('/roles').expect(403);
    await accountant.put('/roles/accountant/permissions').send({ permissions: [] }).expect(403);
    await t.anonymous().get('/roles').expect(401);
  });

  it('lets accountants upload to client folders once they are given clients.edit, at once', async () => {
    await accountant.post('/clients/c-mine/folders').send({ name: 'Before' }).expect(403);

    const current = roleOf((await manager.get('/roles').expect(200)).body, 'accountant');
    await choose('accountant', [...(current?.permissions ?? []), 'clients.edit']).expect(200);

    // The same session, with no new sign-in.
    await accountant.post('/clients/c-mine/folders').send({ name: 'After' }).expect(201);
    const me = await accountant.get('/auth/me').expect(200);
    expect(me.body.permissions).toContain('clients.edit');
  });

  it('takes a permission away just as quickly', async () => {
    await accountant.get('/billing/quotations').expect(200);
    const current = roleOf((await manager.get('/roles').expect(200)).body, 'accountant');
    await choose(
      'accountant',
      (current?.permissions ?? []).filter((permission) => permission !== 'billing.view'),
    ).expect(200);
    await accountant.get('/billing/quotations').expect(403);
  });

  it('applies the choice to the permissions handed out at sign-in too', async () => {
    const [row] = await t.sql<
      { email: string }[]
    >`SELECT email FROM users WHERE id = ${accountant.userId}`;
    const signedIn = await t
      .anonymous()
      .post('/auth/sign-in')
      .send({ email: row?.email, password: PASSWORD })
      .expect(200);
    expect(signedIn.body.caller.permissions).toContain('clients.edit');
    expect(signedIn.body.caller.permissions).not.toContain('billing.view');
  });

  it('keeps a role with nothing ticked to nothing, not back to its defaults', async () => {
    await choose('data_entry', []).expect(200);
    const after = roleOf((await manager.get('/roles').expect(200)).body, 'data_entry');
    expect(after?.permissions).toEqual([]);
    const me = await dataEntry.get('/auth/me').expect(200);
    expect(me.body.permissions).not.toContain('projects.edit');
  });

  it('will not change what a manager may do, hand out users.manage, or grant what does not exist', async () => {
    await choose('manager', ['clients.edit']).expect(400);
    await choose('client', []).expect(400);
    await choose('nobody', []).expect(400);
    await choose('accountant', ['users.manage']).expect(400);
    await choose('accountant', ['launch.rockets']).expect(400);
    await manager.put('/roles/accountant/permissions').send({}).expect(400);
    // The manager still has everything.
    await manager.get('/roles').expect(200);
  });

  it('puts a role back to its defaults when they are saved', async () => {
    const listed = (await manager.get('/roles').expect(200)).body as {
      roles: { role: string; defaults: string[] }[];
    };
    const defaults = listed.roles.find((one) => one.role === 'accountant') ?? { defaults: [] };
    await choose('accountant', defaults.defaults).expect(200);
    await accountant.get('/billing/quotations').expect(200);
    await accountant.post('/clients/c-mine/folders').send({ name: 'Again' }).expect(403);
  });

  it('records who changed what a role may do, from what to what', async () => {
    const rows = await t.sql<
      { entity_id: string; before: unknown; after: unknown; actor_user_id: string }[]
    >`
      SELECT entity_id, before, after, actor_user_id FROM audit_log
      WHERE action = 'identity.role.permissions_changed' ORDER BY occurred_at
    `;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]?.entity_id).toBe('accountant');
    expect(rows[0]?.actor_user_id).toBe(manager.userId);
    expect(JSON.stringify(rows[0]?.after)).toContain('clients.edit');
    expect(JSON.stringify(rows[0]?.before)).not.toContain('clients.edit');
  });
});
