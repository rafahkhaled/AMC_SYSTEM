import { Conflict } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../domain/index.js';
import { SendMessage } from './send-message.js';
import {
  CountingIds,
  FakeClock,
  FakeTransport,
  InMemoryConversations,
  InMemoryMessages,
  RecordingContactLog,
} from './test-doubles.js';

const now = new Date('2026-09-19T10:00:00.000Z');
const hoursBefore = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
/** The manager, who may see every client. */
const caller = {
  userId: 'u-1',
  permissions: new Set(['clients.view.all', 'clients.edit']),
  roles: ['manager'],
  displayName: 'Sara',
};

/** An accountant who is on no clients at all. */
const outsider = {
  userId: 'u-9',
  permissions: new Set(['clients.view.assigned', 'clients.edit']),
  roles: ['accountant'],
  displayName: 'Nadia',
};

async function harness(
  setUp: (conversation: Conversation) => void = (conversation) =>
    conversation.recordInbound({ at: hoursBefore(1), language: 'en' }),
) {
  const conversations = new InMemoryConversations();
  const messages = new InMemoryMessages();
  const log = new RecordingContactLog();
  const transport = new FakeTransport();

  const started = Conversation.start({
    id: 'wc-1',
    phone: '+971501234567',
    clientId: 'c-1',
    contactId: 'k-1',
    language: 'en',
    now: hoursBefore(48),
  });
  if (!started.ok) throw new Error(started.error.message);
  setUp(started.value);
  await conversations.save(started.value);

  const send = new SendMessage(
    conversations,
    messages,
    log,
    transport,
    new FakeClock(now),
    new CountingIds(),
  );
  return { send, conversations, messages, log, transport, conversation: started.value };
}

describe('a person writing to a client', () => {
  it('sends it and writes it down', async () => {
    const h = await harness();
    const sent = await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'On it, Layla.' });

    expect(sent.ok).toBe(true);
    expect(h.transport.sentText[0]).toMatchObject({ to: '+971501234567', body: 'On it, Layla.' });
    expect(h.messages.stored[0]?.status).toBe('sent');
  });

  it('names them as the sender, so the thread shows it was not the bot', async () => {
    const h = await harness();
    await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'On it.' });
    expect(h.messages.stored[0]?.sentByBot).toBe(false);
    expect(h.messages.stored[0]?.snapshot().sentByUserId).toBe('u-1');
  });

  it('takes the conversation over, without anybody pressing a button', async () => {
    const h = await harness();
    await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'On it.' });

    // Having typed to the client, they own it. Leaving the bot to answer the
    // reply would undo what they just did.
    expect(h.conversation.handling).toBe('human');
    expect(h.conversation.assignedUserId).toBe('u-1');
  });

  it('refuses once the window has shut, and says what to do instead', async () => {
    const h = await harness((conversation) =>
      conversation.recordInbound({ at: hoursBefore(30), language: 'en' }),
    );
    const refused = await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'Any news?' });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('approved template');
    expect(h.transport.sentText).toHaveLength(0);
  });

  it('still lets a person write to somebody who opted out of automatic messages', async () => {
    const h = await harness((conversation) => {
      conversation.recordInbound({ at: hoursBefore(1), language: 'en' });
      conversation.optOut(hoursBefore(1));
    });
    // STOP means no more automatic messages, not that their accountant may
    // never contact them again.
    const sent = await h.send.asPerson(caller, {
      conversationId: 'wc-1',
      body: 'About the fine —',
    });
    expect(sent.ok).toBe(true);
  });

  it('records a failure rather than losing the message', async () => {
    const h = await harness();
    h.transport.textWillFail(new Conflict('WhatsApp is unreachable'));

    const failed = await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'On it.' });
    expect(failed.ok).toBe(false);
    expect(h.messages.stored[0]?.status).toBe('failed');
    // And it did not take the conversation over on the strength of a message
    // that never arrived.
    expect(h.conversation.handling).toBe('bot');
  });

  it('refuses an empty message and a conversation that does not exist', async () => {
    const h = await harness();
    expect((await h.send.asPerson(caller, { conversationId: 'wc-1', body: '   ' })).ok).toBe(false);
    expect((await h.send.asPerson(caller, { conversationId: 'nope', body: 'hello' })).ok).toBe(
      false,
    );
  });

  it('reaches the contact log', async () => {
    const h = await harness();
    await h.send.asPerson(caller, { conversationId: 'wc-1', body: 'On it.' });
    expect(h.log.entries[0]).toMatchObject({ clientId: 'c-1', direction: 'outbound' });
    expect(h.log.entries[0]?.summary).toContain('On it.');
  });
});

describe('an automatic template going out', () => {
  it('goes out even though the client has not written for days', async () => {
    const h = await harness((conversation) =>
      conversation.recordInbound({ at: hoursBefore(200), language: 'en' }),
    );
    const sent = await h.send.asTemplate({
      conversationId: 'wc-1',
      name: 'documents_due',
      variables: ['VAT Q3', '28 October'],
    });

    expect(sent.ok).toBe(true);
    expect(h.transport.sentTemplates[0]).toMatchObject({ name: 'documents_due' });
  });

  it('does not take the conversation away from the bot', async () => {
    const h = await harness();
    await h.send.asTemplate({ conversationId: 'wc-1', name: 'documents_due', variables: [] });
    // Leaving the bot able to answer the reply is the point of sending it.
    expect(h.conversation.handling).toBe('bot');
  });

  it('is refused for a client who asked not to receive them', async () => {
    const h = await harness((conversation) => conversation.optOut(hoursBefore(1)));
    const refused = await h.send.asTemplate({
      conversationId: 'wc-1',
      name: 'documents_due',
      variables: [],
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('asked not to receive');
    expect(h.transport.sentTemplates).toHaveLength(0);
  });

  it('says in the log that it was automatic', async () => {
    const h = await harness();
    await h.send.asTemplate({ conversationId: 'wc-1', name: 'documents_due', variables: [] });
    expect(h.log.entries[0]?.summary).toContain('automatic');
  });

  it('is marked as a template, so the thread shows which one went out', async () => {
    const h = await harness();
    await h.send.asTemplate({ conversationId: 'wc-1', name: 'documents_due', variables: ['Q3'] });
    expect(h.messages.stored[0]?.snapshot().templateName).toBe('documents_due');
    expect(h.messages.stored[0]?.kind).toBe('template');
  });
});

describe('taking over and handing back by hand', () => {
  it('takes it', async () => {
    const h = await harness();
    expect((await h.send.takeOver(caller, 'wc-1')).ok).toBe(true);
    expect(h.conversation.handling).toBe('human');
  });

  it('hands it back', async () => {
    const h = await harness();
    await h.send.takeOver(caller, 'wc-1');
    expect((await h.send.handBack(caller, 'wc-1')).ok).toBe(true);
    expect(h.conversation.handling).toBe('bot');
  });

  it('refuses to hand back what nobody holds', async () => {
    const h = await harness();
    expect((await h.send.handBack(caller, 'wc-1')).ok).toBe(false);
  });
});

describe('saying whose number it is', () => {
  it('attaches the client', async () => {
    const conversations = new InMemoryConversations();
    const started = Conversation.start({
      id: 'wc-2',
      phone: '+971559876543',
      language: 'ar',
      now: hoursBefore(2),
    });
    if (!started.ok) throw new Error(started.error.message);
    await conversations.save(started.value);

    const send = new SendMessage(
      conversations,
      new InMemoryMessages(),
      new RecordingContactLog(),
      new FakeTransport(),
      new FakeClock(now),
      new CountingIds(),
    );

    expect((await send.identify(caller, 'wc-2', 'c-9', 'k-9')).ok).toBe(true);
    expect(started.value.clientId).toBe('c-9');
  });

  it('refuses to move a conversation to a different client', async () => {
    const h = await harness();
    const refused = await h.send.identify(caller, 'wc-1', 'c-2');
    expect(refused.ok).toBe(false);
    expect(h.conversation.clientId).toBe('c-1');
  });
});

/**
 * The writer paths, scoped.
 *
 * The screen already hides a conversation an accountant may not see. These
 * check the far more dangerous half: that knowing the id is not enough to reply
 * to somebody else's client, take their conversation, or attach it to a company
 * of your choosing. Every one of these would have passed before `findVisible`
 * existed.
 */
describe('who may act on a conversation', () => {
  it("will not let an outsider write to another accountant's client", async () => {
    const h = await harness();
    const refused = await h.send.asPerson(outsider, {
      conversationId: 'wc-1',
      body: 'Hello, this is about your VAT.',
    });

    expect(refused.ok).toBe(false);
    // The same words as a conversation that does not exist. Saying "not yours"
    // would confirm that Gulf Trading is a client of this firm.
    if (!refused.ok) expect(refused.error.message).toBe('There is no such conversation');
    expect(h.transport.sentText).toHaveLength(0);
  });

  it('will not let an outsider take it over', async () => {
    const h = await harness();
    expect((await h.send.takeOver(outsider, 'wc-1')).ok).toBe(false);
    expect(h.conversation.handling).toBe('bot');
  });

  it('will not let an outsider hand it back', async () => {
    const h = await harness();
    await h.send.takeOver(caller, 'wc-1');
    expect((await h.send.handBack(outsider, 'wc-1')).ok).toBe(false);
    expect(h.conversation.handling).toBe('human');
  });

  it('will not let an outsider say whose number it is', async () => {
    const h = await harness();
    expect((await h.send.identify(outsider, 'wc-1', 'c-2')).ok).toBe(false);
    expect(h.conversation.clientId).toBe('c-1');
  });

  it('lets an accountant act once the client is actually theirs', async () => {
    const h = await harness();
    h.conversations.assign(outsider.userId, 'c-1');

    const sent = await h.send.asPerson(outsider, {
      conversationId: 'wc-1',
      body: 'Hello, this is about your VAT.',
    });
    expect(sent.ok).toBe(true);
  });

  it('lets whoever holds the conversation act on it, client or no client', async () => {
    const h = await harness();
    // An unmatched number handed to somebody: they may answer it even though
    // there is no client to be assigned to.
    await h.send.takeOver(caller, 'wc-1');
    h.conversation.identify({ clientId: 'c-1', now: new Date() });

    const held = await harness();
    await held.send.takeOver(caller, 'wc-1');
    expect((await held.send.handBack(caller, 'wc-1')).ok).toBe(true);
  });
});
