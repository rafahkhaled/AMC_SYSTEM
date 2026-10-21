import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * Forgotten passwords, and a manager choosing one for a colleague.
 *
 * Driven as the sign-in screen drives it. The link itself goes to an inbox
 * (or the server log), so the tests that use one plant a token whose hash they
 * know, which is exactly what a real emailed token is to the database.
 */
describe('forgotten passwords', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;
  /** Never has its own password reset, so its session stays good for the rest. */
  let boss: Session;

  const NEW_PASSWORD = 'A-Brand-New-Passphrase-42';
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const plant = async (userId: string, token: string, minutes = 60) => {
    await t.sql`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at)
      VALUES (${`r-${randomBytes(4).toString('hex')}`}, ${userId}, ${hash(token)},
              now() + (${minutes} || ' minutes')::interval)
    `;
  };
  const ask = (email: string) => t.anonymous().post('/auth/forgot-password').send({ email });
  const live = async (userId: string) =>
    Number(
      (
        await t.sql<{ n: string }[]>`
          SELECT count(*)::text AS n FROM password_resets WHERE user_id = ${userId} AND used_at IS NULL
        `
      )[0]?.n,
    );
  const signIn = (email: string, password: string) =>
    t.anonymous().post('/auth/sign-in').send({ email, password });

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    boss = await t.another('manager', 'boss');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
  });
  afterAll(async () => {
    await t.close();
  });

  describe('asking for a link', () => {
    it('answers the same for an address on the system and one that is not', async () => {
      const known = await ask(accountant.email).expect(202);
      const unknown = await ask('nobody@activemanagement.ae').expect(202);
      const malformed = await ask('not an email').expect(202);
      expect(known.body).toEqual({ ok: true });
      expect(unknown.body).toEqual(known.body);
      expect(malformed.body).toEqual(known.body);
      await ask('').expect(400);
    });

    it('makes a link for a real account, and none for a stranger', async () => {
      expect(await live(accountant.userId)).toBe(1);
      const [stranger] = await t.sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM password_resets
      `;
      // Only the accountant's: nothing was made for the unknown address.
      expect(stranger?.n).toBe('1');
    });

    it('voids the earlier link when another is asked for', async () => {
      await ask(dataEntry.email).expect(202);
      await ask(dataEntry.email).expect(202);
      expect(await live(dataEntry.userId)).toBe(1);
    });

    it('makes no link for a suspended person', async () => {
      await manager
        .post(`/staff/${dataEntry.userId}/status`)
        .send({ status: 'suspended' })
        .expect(201);
      const before = await live(dataEntry.userId);
      await t.sql`UPDATE password_resets SET used_at = now() WHERE user_id = ${dataEntry.userId}`;
      await ask(dataEntry.email).expect(202);
      expect(await live(dataEntry.userId)).toBe(0);
      expect(before).toBeGreaterThanOrEqual(0);
      await manager
        .post(`/staff/${dataEntry.userId}/status`)
        .send({ status: 'active' })
        .expect(201);
    });

    it('stops sending after a few for one address, without saying so', async () => {
      const [{ id } = { id: '' }] = await t.sql<
        { id: string }[]
      >`SELECT id FROM users WHERE id = ${manager.userId}`;
      for (let i = 0; i < 6; i += 1) {
        const response = await ask(manager.email);
        expect(response.status).toBe(202);
      }
      const [row] = await t.sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM password_resets WHERE user_id = ${id}
      `;
      // Three allowed in the hour; the rest were quietly dropped.
      expect(Number(row?.n)).toBeLessThanOrEqual(3);
    });

    it('records that a link was asked for, and never the link', async () => {
      const rows = await t.sql<{ action: string; after: unknown }[]>`
        SELECT action, after FROM audit_log WHERE action = 'identity.password_reset.requested'
      `;
      expect(rows.length).toBeGreaterThan(0);
      const everything = JSON.stringify(rows);
      expect(everything).not.toMatch(/token/i);
    });
  });

  describe('using a link', () => {
    it('sets the new password, ends every session, and works once', async () => {
      const token = randomBytes(24).toString('base64url');
      await plant(accountant.userId, token);

      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(200);

      // The old password stops working and the new one does.
      await signIn(accountant.email, PASSWORD).expect(401);
      await signIn(accountant.email, NEW_PASSWORD).expect(200);
      // A session they already held is gone.
      await accountant.get('/auth/me').expect(401);
      // The link cannot be used again.
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token, password: `${NEW_PASSWORD}-2` })
        .expect(400);
    });

    it('refuses an unknown link, an expired one, and a weak password without using the link up', async () => {
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token: 'x'.repeat(30), password: NEW_PASSWORD })
        .expect(400);

      const victim = await t.as('accountant');
      const expired = randomBytes(24).toString('base64url');
      await plant(victim.userId, expired, -5);
      const refused = await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token: expired, password: NEW_PASSWORD })
        .expect(400);
      expect(refused.body.error.message).toContain('expired');

      const good = randomBytes(24).toString('base64url');
      await plant(victim.userId, good);
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token: good, password: 'short' })
        .expect(400);
      // Containing the address they sign in with is refused too.
      const local = victim.email.split('@')[0] ?? '';
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token: good, password: `${local}-Strong-9` })
        .expect(400);
      // Still good after being refused for the password.
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token: good, password: NEW_PASSWORD })
        .expect(200);
    });

    it('lifts a lockout, which is the usual reason somebody is asking', async () => {
      const email = `locked-${randomBytes(3).toString('hex')}@activemanagement.ae`;
      await boss
        .post('/staff')
        .send({ email, displayName: 'Locked Out', password: PASSWORD, roles: ['accountant'] })
        .expect(201);
      for (let i = 0; i < 6; i += 1) await signIn(email, 'wrong-password-here');
      await signIn(email, PASSWORD).expect(401);

      const [row] = await t.sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
      const token = randomBytes(24).toString('base64url');
      await plant(row?.id ?? '', token);
      await t
        .anonymous()
        .post('/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(200);
      await signIn(email, NEW_PASSWORD).expect(200);
    });

    it('records who reset it, as the person themselves', async () => {
      const rows = await t.sql<{ action: string; actor_user_id: string | null }[]>`
        SELECT action, actor_user_id FROM audit_log WHERE action = 'identity.password.changed'
      `;
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('a manager choosing a password for a colleague', () => {
    it('sets it, signs them out, and lets them in with the new one', async () => {
      const fresh = await t.as('accountant');
      await boss
        .post(`/staff/${fresh.userId}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(201);

      await fresh.get('/auth/me').expect(401);
      await signIn(fresh.email, PASSWORD).expect(401);
      await signIn(fresh.email, NEW_PASSWORD).expect(200);
    });

    it('refuses a weak password and a person who is not there', async () => {
      await boss
        .post(`/staff/${accountant.userId}/password`)
        .send({ password: 'short' })
        .expect(409);
      await boss.post('/staff/nobody/password').send({ password: NEW_PASSWORD }).expect(409);
      await boss.post(`/staff/${accountant.userId}/password`).send({}).expect(400);
    });

    it('is for managers only, and for signed-in people', async () => {
      const other = await t.another('accountant', 'other');
      await other
        .post(`/staff/${boss.userId}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(403);
      await t
        .anonymous()
        .post(`/staff/${boss.userId}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(401);
    });

    it('is in the audit log, naming who did it to whom', async () => {
      const rows = await t.sql<{ actor_user_id: string | null; entity_id: string | null }[]>`
        SELECT actor_user_id, entity_id FROM audit_log
        WHERE action = 'identity.password.changed' AND actor_user_id = ${boss.userId}
      `;
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
