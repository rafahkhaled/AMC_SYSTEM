import { describe, expect, it } from 'vitest';
import { Conversation } from './conversation.js';

const now = new Date('2026-09-19T10:00:00.000Z');
const hoursBefore = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function started(overrides: Partial<Parameters<typeof Conversation.start>[0]> = {}) {
  const result = Conversation.start({
    id: 'wc-1',
    phone: '+971501234567',
    language: 'ar',
    now,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('starting a conversation', () => {
  it('starts with the bot answering and nothing awaited', () => {
    const conversation = started();
    expect(conversation.handling).toBe('bot');
    expect(conversation.botMaySpeak).toBe(true);
    expect(conversation.awaiting).toBeNull();
  });

  it('refuses a number that has not been reduced first', () => {
    // Otherwise '050 123 4567' and '+971501234567' become two conversations
    // with the same person, and only one of them has their history.
    const refused = Conversation.start({
      id: 'wc-2',
      phone: '050 123 4567',
      language: 'ar',
      now,
    });
    expect(refused.ok).toBe(false);
  });

  it('is happy to know nobody', () => {
    const conversation = started();
    expect(conversation.clientId).toBeNull();
  });

  it('refuses a contact without the client it belongs to', () => {
    const refused = Conversation.start({
      id: 'wc-3',
      phone: '+971501234567',
      contactId: 'k-1',
      language: 'ar',
      now,
    });
    expect(refused.ok).toBe(false);
  });

  it('says whether it matched anybody, so a screen can queue the ones that did not', () => {
    const unmatched = started().pullEvents();
    expect(unmatched[0]?.name).toBe('whatsapp.conversation.started');
    expect(unmatched[0]?.payload).toMatchObject({ matched: false });

    const matched = started({ clientId: 'c-1' }).pullEvents();
    expect(matched[0]?.payload).toMatchObject({ matched: true, clientId: 'c-1' });
  });
});

describe('the bot holding its tongue', () => {
  it('will not speak once a person has taken over', () => {
    const conversation = started();
    conversation.takeOver({ userId: 'u-1', reason: 'asked_for', now });
    expect(conversation.botMaySpeak).toBe(false);
  });

  it('will not speak into a closed conversation', () => {
    const conversation = started();
    conversation.close(now);
    expect(conversation.botMaySpeak).toBe(false);
  });

  it('speaks again once a person hands it back', () => {
    const conversation = started();
    conversation.takeOver({ userId: 'u-1', reason: 'staff_chose', now });
    const handed = conversation.handBack(now);
    expect(handed.ok).toBe(true);
    expect(conversation.botMaySpeak).toBe(true);
    expect(conversation.assignedUserId).toBeNull();
  });

  it('does not let the client write their way out of a person handling it', () => {
    const conversation = started();
    conversation.takeOver({ userId: 'u-1', reason: 'asked_for', now });
    conversation.recordInbound({ at: now, language: 'ar' });

    // The client answering "yes" to their accountant must not be met with a
    // menu. This is the rule the whole aggregate exists for.
    expect(conversation.botMaySpeak).toBe(false);
    expect(conversation.handling).toBe('human');
  });

  it('reopens a closed conversation when the client writes again', () => {
    const conversation = started();
    conversation.close(now);
    conversation.recordInbound({ at: now, language: 'ar' });
    expect(conversation.handling).toBe('bot');
  });
});

describe('taking over and handing back', () => {
  it('clears what the bot was waiting for', () => {
    const conversation = started();
    conversation.nowAwaiting('menu_choice');
    conversation.takeOver({ userId: 'u-1', reason: 'bot_gave_up', now });
    expect(conversation.awaiting).toBeNull();
  });

  it('records who took it and why', () => {
    const conversation = started({ clientId: 'c-1' });
    conversation.pullEvents();
    conversation.takeOver({ userId: 'u-1', reason: 'bot_gave_up', now });

    const [event] = conversation.pullEvents();
    expect(event?.name).toBe('whatsapp.conversation.taken_over');
    expect(event?.payload).toMatchObject({ userId: 'u-1', reason: 'bot_gave_up' });
  });

  it('is quiet when the same person takes it over twice', () => {
    const conversation = started();
    conversation.takeOver({ userId: 'u-1', reason: 'staff_chose', now });
    conversation.pullEvents();
    conversation.takeOver({ userId: 'u-1', reason: 'staff_chose', now });
    expect(conversation.pullEvents()).toHaveLength(0);
  });

  it('records the handover when it moves to somebody else', () => {
    const conversation = started();
    conversation.takeOver({ userId: 'u-1', reason: 'staff_chose', now });
    conversation.pullEvents();
    conversation.takeOver({ userId: 'u-2', reason: 'staff_chose', now });
    const [event] = conversation.pullEvents();
    expect(event?.payload).toMatchObject({ userId: 'u-2', previousUserId: 'u-1' });
  });

  it('refuses to hand back what no person is holding', () => {
    expect(started().handBack(now).ok).toBe(false);
  });
});

describe('giving up', () => {
  it('asks once more, then fetches somebody', () => {
    const conversation = started();
    expect(conversation.didNotFollow()).toBe('ask_again');
    expect(conversation.didNotFollow()).toBe('give_up');
  });

  it('forgives one odd message once it understands the next', () => {
    const conversation = started();
    expect(conversation.didNotFollow()).toBe('ask_again');
    conversation.followed();
    // The streak starts again rather than carrying, so a client who mistypes
    // once in the morning is not handed to a person at four in the afternoon.
    expect(conversation.didNotFollow()).toBe('ask_again');
  });
});

describe('identifying whose number it is', () => {
  it('attaches the client', () => {
    const conversation = started();
    const identified = conversation.identify({ clientId: 'c-1', contactId: 'k-1', now });
    expect(identified.ok).toBe(true);
    expect(conversation.clientId).toBe('c-1');
    expect(conversation.contactId).toBe('k-1');
  });

  it('refuses to move a conversation to a different client', () => {
    // Everything already filed against the first client came from this
    // conversation. Moving it silently would move a trade licence to another
    // company's file.
    const conversation = started({ clientId: 'c-1' });
    const refused = conversation.identify({ clientId: 'c-2', now });
    expect(refused.ok).toBe(false);
    expect(conversation.clientId).toBe('c-1');
  });

  it('is happy to be told the same client again', () => {
    const conversation = started({ clientId: 'c-1' });
    expect(conversation.identify({ clientId: 'c-1', contactId: 'k-9', now }).ok).toBe(true);
    expect(conversation.contactId).toBe('k-9');
  });
});

describe('what may be sent', () => {
  it('allows our own words while the client has written recently', () => {
    const conversation = started();
    conversation.recordInbound({ at: hoursBefore(1), language: 'ar' });
    expect(conversation.maySend({ kind: 'text', body: 'Received' }, now).ok).toBe(true);
  });

  it('refuses our own words a day later, and allows a template', () => {
    const conversation = started();
    conversation.recordInbound({ at: hoursBefore(30), language: 'ar' });
    expect(conversation.maySend({ kind: 'text', body: 'Any news?' }, now).ok).toBe(false);
    expect(conversation.maySend({ kind: 'template', name: 'documents_due' }, now).ok).toBe(true);
  });

  it('refuses free text into a closed conversation even inside the window', () => {
    const conversation = started();
    conversation.recordInbound({ at: hoursBefore(1), language: 'ar' });
    conversation.close(now);
    expect(conversation.maySend({ kind: 'text', body: 'Hello again' }, now).ok).toBe(false);
    // A chase by template is how a closed conversation is restarted.
    expect(conversation.maySend({ kind: 'template', name: 'documents_due' }, now).ok).toBe(true);
  });

  it('reports the window, for a screen that shows a person the clock', () => {
    const conversation = started();
    conversation.recordInbound({ at: hoursBefore(1), language: 'ar' });
    expect(conversation.windowAt(now)).toBe('open');
    conversation.recordInbound({ at: hoursBefore(25), language: 'ar' });
    expect(conversation.windowAt(now)).toBe('closed');
  });
});

describe('the language', () => {
  it('follows what the client last wrote in', () => {
    const conversation = started({ language: 'ar' });
    conversation.recordInbound({ at: now, language: 'en' });
    expect(conversation.language).toBe('en');
  });
});

describe('being asked to stop', () => {
  it('stops templates as well as free text', () => {
    // This is the whole difference between opting out and closing. A client who
    // typed STOP and then got the next automatic reminder anyway was ignored.
    const conversation = started();
    conversation.recordInbound({ at: hoursBefore(1), language: 'ar' });
    conversation.optOut(now);

    expect(conversation.maySend({ kind: 'text', body: 'Any news?' }, now).ok).toBe(false);
    expect(conversation.maySend({ kind: 'template', name: 'documents_due' }, now).ok).toBe(false);
  });

  it('says so, so a screen can tell a person why they cannot write', () => {
    const conversation = started();
    conversation.optOut(now);
    const refused = conversation.maySend({ kind: 'template', name: 'documents_due' }, now);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('asked not to receive');
  });

  it('is not undone by the client writing again', () => {
    const conversation = started();
    conversation.optOut(now);
    conversation.recordInbound({ at: now, language: 'ar' });

    // "One more thing" is not consent, and answering it with the bot would read
    // it as consent it does not give.
    expect(conversation.optedOut).toBe(true);
    expect(conversation.botMaySpeak).toBe(false);
  });

  it('is undone by START, because it is always reversible', () => {
    const conversation = started();
    conversation.optOut(now);
    conversation.optBackIn(now);
    expect(conversation.optedOut).toBe(false);
    expect(conversation.botMaySpeak).toBe(true);
  });

  it('records each change of mind once', () => {
    const conversation = started();
    conversation.pullEvents();

    conversation.optOut(now);
    conversation.optOut(now);
    expect(conversation.pullEvents().map((event) => event.name)).toEqual([
      'whatsapp.conversation.opted_out',
    ]);

    conversation.optBackIn(now);
    conversation.optBackIn(now);
    expect(conversation.pullEvents().map((event) => event.name)).toEqual([
      'whatsapp.conversation.opted_back_in',
    ]);
  });
});
