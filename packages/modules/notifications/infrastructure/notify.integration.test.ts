import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Notify } from '../application/notify.js';
import { ReadInbox } from '../application/read-inbox.js';
import {
  DrizzleNotificationRepository,
  DrizzlePreferenceRepository,
} from './notification.repository.js';

const NOW = new Date('2026-09-17T06:00:00Z');

const WORDING = {
  titleEn: 'Gulf Trading LLC: chase the documents',
  titleAr: 'الخليج للتجارة: متابعة المستندات',
  bodyEn: 'The paperwork was asked for a week ago.',
  bodyAr: 'مضى أسبوع على طلب المستندات.',
};

describe('telling people things, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function scenario(tx: unknown) {
    const db = tx as ReturnType<typeof drizzle>;
    await db.execute(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ('ntf-u1', 'ntf@activemanagement.ae', 'Wael Ajam', 'x')`,
    );

    const sent: { to: string; subject: string }[] = [];
    let counter = 0;

    const notifications = new DrizzleNotificationRepository(db);
    const preferences = new DrizzlePreferenceRepository(db);
    const notify = new Notify(
      notifications,
      preferences,
      { find: async () => ({ email: 'ntf@activemanagement.ae', language: 'ar' as const }) },
      { send: async (message) => void sent.push({ to: message.to, subject: message.subject }) },
      { now: () => NOW },
      { next: () => `ntf-${++counter}` },
    );

    return {
      db,
      sent,
      notify,
      preferences,
      inbox: new ReadInbox(notifications, preferences, { now: () => NOW }),
    };
  }

  const escalation = (over: Record<string, unknown> = {}) => ({
    userId: 'ntf-u1',
    kind: 'escalation' as const,
    subjectType: 'task',
    subjectId: 'task-1:client_reminder',
    wording: WORDING,
    ...over,
  });

  it('tells somebody once, however many times the sweep runs', async () => {
    /*
     * The sweep is meant to be safe to run twice in a morning, or to catch up
     * after a week of downtime. Uniqueness lives in the database so it does
     * not have to remember what it did yesterday.
     */
    await database.inRollbackTransaction(async (tx) => {
      const { notify, inbox } = await scenario(tx);

      expect(await notify.send(escalation())).toBe('sent');
      expect(await notify.send(escalation())).toBe('already_told');

      const read = await inbox.forCaller({ userId: 'ntf-u1' });
      expect(read.entries).toHaveLength(1);
      expect(read.unread).toBe(1);
    });
  });

  it('emails only the first time, so a repeat sweep does not send twice', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { notify, sent } = await scenario(tx);

      await notify.send(escalation());
      await notify.send(escalation());

      expect(sent).toHaveLength(1);
    });
  });

  it('writes the email in the language the person reads', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { notify, sent } = await scenario(tx);
      await notify.send(escalation());
      expect(sent[0]?.subject).toBe(WORDING.titleAr);
    });
  });

  it('does not email a kind somebody has turned email off for', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { notify, preferences, sent, inbox } = await scenario(tx);
      await preferences.set('ntf-u1', 'escalation', { inApp: true, email: false });

      expect(await notify.send(escalation())).toBe('sent');
      expect(sent).toHaveLength(0);
      // Still in the inbox. Turning the email off is not turning it off.
      expect((await inbox.forCaller({ userId: 'ntf-u1' })).entries).toHaveLength(1);
    });
  });

  it('tells somebody nothing at all when they want neither', async () => {
    // An inbox quietly filling with things somebody asked not to see is worse
    // than silence, because they stop looking at the inbox.
    await database.inRollbackTransaction(async (tx) => {
      const { notify, preferences, sent, inbox } = await scenario(tx);
      await preferences.set('ntf-u1', 'escalation', { inApp: false, email: false });

      expect(await notify.send(escalation())).toBe('not_wanted');
      expect(sent).toHaveLength(0);
      expect((await inbox.forCaller({ userId: 'ntf-u1' })).entries).toHaveLength(0);
    });
  });

  it('keeps the notification when the email fails', async () => {
    /*
     * The inbox entry is the record that somebody was told. Losing it because
     * a mail server was briefly down would be the worse failure, so the email
     * is attempted after the row is stored and its failure is swallowed.
     */
    await database.inRollbackTransaction(async (tx) => {
      const { db } = await scenario(tx);
      const notifications = new DrizzleNotificationRepository(db);
      const preferences = new DrizzlePreferenceRepository(db);
      const notify = new Notify(
        notifications,
        preferences,
        { find: async () => ({ email: 'ntf@activemanagement.ae', language: 'en' as const }) },
        { send: vi.fn(async () => Promise.reject(new Error('the mail server is down'))) },
        { now: () => NOW },
        { next: () => 'ntf-x' },
      );

      expect(await notify.send(escalation())).toBe('sent');

      const read = await new ReadInbox(notifications, preferences, { now: () => NOW }).forCaller({
        userId: 'ntf-u1',
      });
      expect(read.entries).toHaveLength(1);
    });
  });

  it('counts a later rung as a different thing to say', async () => {
    // Otherwise the fourteen-day alert is swallowed as a duplicate of the
    // seven-day one and nobody is ever told the chase escalated.
    await database.inRollbackTransaction(async (tx) => {
      const { notify, inbox } = await scenario(tx);

      await notify.send(escalation({ subjectId: 'task-1:client_reminder' }));
      await notify.send(escalation({ subjectId: 'task-1:accountant_alert' }));

      expect((await inbox.forCaller({ userId: 'ntf-u1' })).entries).toHaveLength(2);
    });
  });

  it('marks everything read in one go', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const { notify, inbox } = await scenario(tx);
      await notify.send(escalation({ subjectId: 'a' }));
      await notify.send(escalation({ subjectId: 'b' }));

      expect(await inbox.markAllRead({ userId: 'ntf-u1' })).toBe(2);
      expect((await inbox.forCaller({ userId: 'ntf-u1' })).unread).toBe(0);
    });
  });

  it('lists every kind on the settings screen, chosen or not', async () => {
    // A screen that lists only what somebody has already changed is one where
    // the untouched settings are invisible.
    await database.inRollbackTransaction(async (tx) => {
      const { inbox, preferences } = await scenario(tx);
      await preferences.set('ntf-u1', 'escalation', { inApp: false, email: false });

      const shown = await inbox.preferencesFor({ userId: 'ntf-u1' });
      expect(shown).toHaveLength(5);
      expect(shown.find((p) => p.kind === 'escalation')).toEqual({
        kind: 'escalation',
        inApp: false,
        email: false,
      });
      // Untouched, so the default shows through.
      expect(shown.find((p) => p.kind === 'deadline_near')?.email).toBe(true);
    });
  });
});
