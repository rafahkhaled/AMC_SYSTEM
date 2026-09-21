import { type TestDatabase, createTestDatabase } from '@amc/database/testing';
import type { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Conversation, Message } from '../domain/index.js';
import { DrizzleConversationReader } from './conversation.reader.js';
import {
  DrizzleConversationRepository,
  DrizzleMessageRepository,
} from './conversation.repository.js';
import { DrizzleContactDirectory } from './directory.js';

type Db = ReturnType<typeof drizzle>;

const NOW = new Date('2026-09-21T09:00:00.000Z');
const AN_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);

/**
 * Two accountants, three clients and the contacts who write in.
 *
 * `hana` is assigned to Gulf and to Marina; `omar` to Delta only. That is what
 * makes the scope tests mean something: every assertion about what `omar` can
 * see is also an assertion that he cannot see Gulf's conversation.
 */
async function world(db: Db): Promise<void> {
  await db.execute(`
    INSERT INTO users (id, email, display_name, password_hash) VALUES
      ('wa-hana', 'hana@activemanagement.ae', 'Hana Saeed', 'x'),
      ('wa-omar', 'omar@activemanagement.ae', 'Omar Nasser', 'x'),
      ('wa-boss', 'boss@activemanagement.ae', 'The Manager', 'x')
  `);
  await db.execute(`
    INSERT INTO clients (id, legal_name, status) VALUES
      ('wa-gulf',   'Gulf Trading LLC', 'active'),
      ('wa-marina', 'Marina Holdings',  'active'),
      ('wa-delta',  'Delta Services',   'active'),
      ('wa-shut',   'Old Company',      'closed')
  `);
  await db.execute(`
    INSERT INTO client_staff_access (client_id, user_id, assigned_by) VALUES
      ('wa-gulf',   'wa-hana', 'wa-boss'),
      ('wa-marina', 'wa-hana', 'wa-boss'),
      ('wa-delta',  'wa-omar', 'wa-boss')
  `);
  await db.execute(`
    INSERT INTO client_contacts (id, client_id, name, phone, is_primary) VALUES
      ('wa-k-gulf',  'wa-gulf',   'Layla Hassan', '050 123 4567', true),
      ('wa-k-delta', 'wa-delta',  'Faisal Ahmed', '+971 55 765 4321', true),
      ('wa-k-shut',  'wa-shut',   'Nobody',       '0561111111', true)
  `);
}

describe('the directory, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('matches a number written one way against a number stored another', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      // Stored as '050 123 4567'. WhatsApp hands over '971501234567', which
      // this module reduces to '+971501234567' before asking.
      const found = await new DrizzleContactDirectory(db).whoseNumber('+971501234567');

      expect(found).toEqual({
        clientId: 'wa-gulf',
        contactId: 'wa-k-gulf',
        contactName: 'Layla Hassan',
        language: null,
      });
    });
  });

  it('knows nobody by a number nobody has', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      expect(await new DrizzleContactDirectory(db).whoseNumber('+971509999999')).toBeNull();
    });
  });

  it('does not match a closed client, whose files nobody should be adding to', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      expect(await new DrizzleContactDirectory(db).whoseNumber('+971561111111')).toBeNull();
    });
  });

  it('refuses to choose when two clients share a number', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // An owner of two companies, listed at both. Guessing here would file one
      // company's documents against the other.
      await db.execute(`
        INSERT INTO client_contacts (id, client_id, name, phone)
        VALUES ('wa-k-both', 'wa-marina', 'Layla Hassan', '0501234567')
      `);

      expect(await new DrizzleContactDirectory(db).whoseNumber('+971501234567')).toBeNull();
    });
  });

  it('still answers when one client lists the same number twice', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      // The same person entered twice at the same client is a duplicate, not
      // an ambiguity: whose it is has only one answer.
      await db.execute(`
        INSERT INTO client_contacts (id, client_id, name, phone)
        VALUES ('wa-k-dup', 'wa-gulf', 'Layla H', '0501234567')
      `);

      const found = await new DrizzleContactDirectory(db).whoseNumber('+971501234567');
      expect(found?.clientId).toBe('wa-gulf');
      // The primary record wins, so the answer does not change tomorrow.
      expect(found?.contactId).toBe('wa-k-gulf');
    });
  });
});

describe('conversations and messages, against a real database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  async function conversationFor(
    db: Db,
    params: { id: string; phone: string; clientId?: string | null },
  ): Promise<Conversation> {
    const started = Conversation.start({
      id: params.id,
      phone: params.phone,
      clientId: params.clientId ?? null,
      language: 'ar',
      now: THREE_DAYS_AGO,
    });
    if (!started.ok) throw started.error;
    await new DrizzleConversationRepository(db).save(started.value);
    return started.value;
  }

  it('finds a conversation by the number it belongs to', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await conversationFor(db, { id: 'wa-c1', phone: '+971501234567', clientId: 'wa-gulf' });

      const repository = new DrizzleConversationRepository(db);
      const found = await repository.findByPhone('+971501234567');

      expect(found?.id).toBe('wa-c1');
      expect(found?.snapshot().clientId).toBe('wa-gulf');
      expect(await repository.findByPhone('+971509999999')).toBeNull();
    });
  });

  it('keeps what a person changed, across a reload', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      const conversation = await conversationFor(db, {
        id: 'wa-c2',
        phone: '+971501234567',
        clientId: 'wa-gulf',
      });

      conversation.recordInbound({ at: AN_HOUR_AGO, language: 'en' });
      const taken = conversation.takeOver({ userId: 'wa-hana', reason: 'asked_for', now: NOW });
      expect(taken.ok).toBe(true);

      const repository = new DrizzleConversationRepository(db);
      await repository.save(conversation);

      const reloaded = await repository.findById('wa-c2');
      const state = reloaded?.snapshot();
      expect(state?.handling).toBe('human');
      expect(state?.assignedUserId).toBe('wa-hana');
      expect(state?.language).toBe('en');
      expect(state?.lastInboundAt?.toISOString()).toBe(AN_HOUR_AGO.toISOString());
    });
  });

  it('stores an inbound message once, however often Meta sends it', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await conversationFor(db, { id: 'wa-c3', phone: '+971501234567', clientId: 'wa-gulf' });

      const messages = new DrizzleMessageRepository(db);
      const make = (id: string) =>
        Message.received({
          id,
          conversationId: 'wa-c3',
          providerMessageId: 'wamid.SAME',
          kind: 'text',
          body: 'متى موعد الإقرار؟',
          occurredAt: AN_HOUR_AGO,
        });

      const first = make('wa-m1');
      const again = make('wa-m2');
      if (!first.ok || !again.ok) throw new Error('fixture');

      expect(await messages.store(first.value)).toBe('stored');
      // Meta retries a delivery it believes failed, and it retries often. The
      // unique index is the whole of the duplicate handling; without it the
      // client is answered twice.
      expect(await messages.store(again.value)).toBe('already_had_it');
      expect(await messages.thread('wa-c3', 50)).toHaveLength(1);
    });
  });

  it('refuses an outbound message that claims to have been received', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await conversationFor(db, { id: 'wa-c4', phone: '+971501234567', clientId: 'wa-gulf' });

      // The constraint exists because a bug that writes the wrong direction
      // otherwise shows up as a message that was apparently never sent.
      await expect(
        db.execute(`
          INSERT INTO whatsapp_messages
            (id, conversation_id, direction, kind, body, status, occurred_at)
          VALUES ('wa-bad', 'wa-c4', 'outbound', 'text', 'hello', 'received', now())
        `),
      ).rejects.toThrow();
    });
  });

  it('refuses a failure with no reason, and a template with no name', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);
      await conversationFor(db, { id: 'wa-c5', phone: '+971501234567', clientId: 'wa-gulf' });

      await expect(
        db.execute(`
          INSERT INTO whatsapp_messages
            (id, conversation_id, direction, kind, body, status, occurred_at)
          VALUES ('wa-bad2', 'wa-c5', 'outbound', 'text', 'hello', 'failed', now())
        `),
      ).rejects.toThrow();

      await expect(
        db.execute(`
          INSERT INTO whatsapp_messages
            (id, conversation_id, direction, kind, body, status, occurred_at)
          VALUES ('wa-bad3', 'wa-c5', 'outbound', 'template', 'hello', 'sent', now())
        `),
      ).rejects.toThrow();
    });
  });
});

describe('who may read a conversation', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  /** Gulf's conversation, Delta's, and one from a number nobody knows. */
  async function threeConversations(db: Db): Promise<void> {
    await world(db);
    const repository = new DrizzleConversationRepository(db);

    for (const [id, phone, clientId] of [
      ['wa-s-gulf', '+971501234567', 'wa-gulf'],
      ['wa-s-delta', '+971557654321', 'wa-delta'],
      ['wa-s-stranger', '+971509999999', null],
    ] as const) {
      const started = Conversation.start({
        id,
        phone,
        clientId,
        language: 'ar',
        now: THREE_DAYS_AGO,
      });
      if (!started.ok) throw started.error;
      started.value.recordInbound({ at: AN_HOUR_AGO, language: 'ar' });
      await repository.save(started.value);
    }
  }

  it('shows the manager everything, including the unmatched number', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await threeConversations(db);

      const seen = await new DrizzleConversationReader(db).list({ kind: 'all' }, NOW);
      expect(seen.map((row) => row.id).sort()).toEqual([
        'wa-s-delta',
        'wa-s-gulf',
        'wa-s-stranger',
      ]);
    });
  });

  it("shows an accountant their own clients and not another's", async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await threeConversations(db);

      const reader = new DrizzleConversationReader(db);
      const hana = await reader.list({ kind: 'assigned', userId: 'wa-hana' }, NOW);
      const omar = await reader.list({ kind: 'assigned', userId: 'wa-omar' }, NOW);

      expect(hana.map((row) => row.id)).toEqual(['wa-s-gulf']);
      expect(omar.map((row) => row.id)).toEqual(['wa-s-delta']);
    });
  });

  it('hides an unmatched number from an accountant until it is handed to them', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await threeConversations(db);

      const repository = new DrizzleConversationRepository(db);
      const reader = new DrizzleConversationReader(db);

      // Before: a stranger's first message could say anything, and until
      // somebody says whose number it is, it might be anybody's client.
      const before = await reader.list({ kind: 'assigned', userId: 'wa-omar' }, NOW);
      expect(before.map((row) => row.id)).not.toContain('wa-s-stranger');

      const stranger = await repository.findById('wa-s-stranger');
      if (!stranger) throw new Error('fixture');
      stranger.takeOver({ userId: 'wa-omar', reason: 'staff_chose', now: NOW });
      await repository.save(stranger);

      const after = await reader.list({ kind: 'assigned', userId: 'wa-omar' }, NOW);
      expect(after.map((row) => row.id).sort()).toEqual(['wa-s-delta', 'wa-s-stranger']);
    });
  });

  it('answers not-found rather than forbidden for a thread out of scope', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await threeConversations(db);

      const reader = new DrizzleConversationReader(db);
      // Saying "forbidden" would confirm a conversation with that id exists,
      // which is itself the thing being kept from them.
      expect(await reader.thread('wa-s-gulf', { kind: 'assigned', userId: 'wa-omar' }, NOW)).toBe(
        null,
      );
      expect(
        await reader.thread('wa-s-gulf', { kind: 'assigned', userId: 'wa-hana' }, NOW),
      ).not.toBeNull();
    });
  });

  it('shows nothing at all to somebody with no client permission', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await threeConversations(db);

      const reader = new DrizzleConversationReader(db);
      expect(await reader.list({ kind: 'none' }, NOW)).toEqual([]);
      expect(await reader.thread('wa-s-gulf', { kind: 'none' }, NOW)).toBeNull();
    });
  });
});

describe('what the conversations screen shows', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.close();
  });

  it('works out the service window on the server, not in the browser', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const repository = new DrizzleConversationRepository(db);
      const open = Conversation.start({
        id: 'wa-w1',
        phone: '+971501234567',
        clientId: 'wa-gulf',
        language: 'ar',
        now: THREE_DAYS_AGO,
      });
      const shut = Conversation.start({
        id: 'wa-w2',
        phone: '+971557654321',
        clientId: 'wa-delta',
        language: 'ar',
        now: THREE_DAYS_AGO,
      });
      if (!open.ok || !shut.ok) throw new Error('fixture');

      open.value.recordInbound({ at: AN_HOUR_AGO, language: 'ar' });
      shut.value.recordInbound({ at: THREE_DAYS_AGO, language: 'ar' });
      await repository.save(open.value);
      await repository.save(shut.value);

      const rows = await new DrizzleConversationReader(db).list({ kind: 'all' }, NOW);
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(byId.get('wa-w1')?.windowOpen).toBe(true);
      expect(byId.get('wa-w1')?.windowClosesAt).toBe('2026-09-22T08:00:00.000Z');
      expect(byId.get('wa-w2')?.windowOpen).toBe(false);
    });
  });

  it('counts what the client said since anyone last answered', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const conversations = new DrizzleConversationRepository(db);
      const messages = new DrizzleMessageRepository(db);

      const started = Conversation.start({
        id: 'wa-u1',
        phone: '+971501234567',
        clientId: 'wa-gulf',
        language: 'ar',
        now: THREE_DAYS_AGO,
      });
      if (!started.ok) throw started.error;

      // Answered two days ago; two messages since, one before.
      started.value.recordOutbound(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000));
      started.value.recordInbound({ at: AN_HOUR_AGO, language: 'ar' });
      await conversations.save(started.value);

      const stamps = [THREE_DAYS_AGO, AN_HOUR_AGO, new Date(NOW.getTime() - 30 * 60 * 1000)];
      for (const [index, at] of stamps.entries()) {
        const message = Message.received({
          id: `wa-um${index}`,
          conversationId: 'wa-u1',
          providerMessageId: `wamid.U${index}`,
          kind: 'text',
          body: 'مرحبا',
          occurredAt: at,
        });
        if (!message.ok) throw message.error;
        await messages.store(message.value);
      }

      const [row] = await new DrizzleConversationReader(db).list({ kind: 'all' }, NOW);
      expect(row?.unreadFromClient).toBe(2);
    });
  });

  it('names the client and the person, so nobody reads a thread by phone number', async () => {
    await database.inRollbackTransaction(async (tx) => {
      const db = tx as unknown as Db;
      await world(db);

      const started = Conversation.start({
        id: 'wa-n1',
        phone: '+971501234567',
        clientId: 'wa-gulf',
        contactId: 'wa-k-gulf',
        language: 'ar',
        now: THREE_DAYS_AGO,
      });
      if (!started.ok) throw started.error;
      started.value.recordInbound({ at: AN_HOUR_AGO, language: 'ar' });
      started.value.takeOver({ userId: 'wa-hana', reason: 'asked_for', now: NOW });
      await new DrizzleConversationRepository(db).save(started.value);

      const [row] = await new DrizzleConversationReader(db).list({ kind: 'all' }, NOW);
      expect(row?.clientName).toBe('Gulf Trading LLC');
      expect(row?.contactName).toBe('Layla Hassan');
      expect(row?.assignedName).toBe('Hana Saeed');
      expect(row?.phoneFormatted).toBe('+971 50 123 4567');
    });
  });
});
