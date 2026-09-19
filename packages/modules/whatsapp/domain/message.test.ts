import { describe, expect, it } from 'vitest';
import { Message, carriesFile, isReadable } from './message.js';

const at = new Date('2026-09-19T10:00:00.000Z');

function received(overrides: Partial<Parameters<typeof Message.received>[0]> = {}) {
  const result = Message.received({
    id: 'wm-1',
    conversationId: 'wc-1',
    providerMessageId: 'wamid.1',
    kind: 'text',
    body: 'Hello',
    occurredAt: at,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function queued(overrides: Partial<Parameters<typeof Message.queued>[0]> = {}) {
  const result = Message.queued({
    id: 'wm-2',
    conversationId: 'wc-1',
    body: 'Received',
    occurredAt: at,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('a message that arrived', () => {
  it('is received, and nothing else', () => {
    expect(received().status).toBe('received');
  });

  it('refuses to be empty', () => {
    // An empty bubble in the thread cannot be told apart from something lost.
    const refused = Message.received({
      id: 'wm-3',
      conversationId: 'wc-1',
      providerMessageId: 'wamid.3',
      kind: 'location',
      occurredAt: at,
    });
    expect(refused.ok).toBe(false);
  });

  it('is content with a file and no words', () => {
    const withFile = Message.received({
      id: 'wm-4',
      conversationId: 'wc-1',
      providerMessageId: 'wamid.4',
      kind: 'image',
      mediaId: 'media-1',
      occurredAt: at,
    });
    expect(withFile.ok).toBe(true);
  });

  it('treats whitespace as nothing said', () => {
    const refused = Message.received({
      id: 'wm-5',
      conversationId: 'wc-1',
      providerMessageId: 'wamid.5',
      kind: 'text',
      body: '   ',
      occurredAt: at,
    });
    expect(refused.ok).toBe(false);
  });
});

describe('a message going out', () => {
  it('is written down before it is sent', () => {
    expect(queued().status).toBe('queued');
  });

  it('knows the bot sent it when nobody is named', () => {
    expect(queued().sentByBot).toBe(true);
    expect(queued({ sentByUserId: 'u-1' }).sentByBot).toBe(false);
  });

  it('is a template when it names one', () => {
    expect(queued({ body: null, templateName: 'documents_due' }).kind).toBe('template');
    expect(queued().kind).toBe('text');
  });

  it('refuses to be nothing at all', () => {
    const refused = Message.queued({ id: 'wm-6', conversationId: 'wc-1', occurredAt: at });
    expect(refused.ok).toBe(false);
  });
});

describe('delivery status, which arrives out of order', () => {
  it('moves forwards', () => {
    const message = queued();
    message.accepted('wamid.out.1');
    expect(message.status).toBe('sent');
    message.advanceTo('delivered');
    expect(message.status).toBe('delivered');
    message.advanceTo('read');
    expect(message.status).toBe('read');
  });

  it('ignores a callback that arrived late', () => {
    // Meta routinely sends `delivered` before `sent`. Writing whatever arrived
    // last shows a message the client has read as merely sent, and invites
    // somebody to send it again.
    const message = queued();
    message.advanceTo('read');
    message.advanceTo('sent');
    expect(message.status).toBe('read');

    message.advanceTo('delivered');
    expect(message.status).toBe('read');
  });

  it('does not let acceptance pull a delivered message backwards', () => {
    const message = queued();
    message.advanceTo('delivered');
    message.accepted('wamid.out.2');
    expect(message.status).toBe('delivered');
    // The id is still recorded, which is the other half of what acceptance is.
    expect(message.snapshot().providerMessageId).toBe('wamid.out.2');
  });

  it('lets a failure land from anywhere, because it really did fail', () => {
    const message = queued();
    message.advanceTo('delivered');
    message.advanceTo('failed', 'Recipient has no WhatsApp account');
    expect(message.status).toBe('failed');
    expect(message.snapshot().failureReason).toBe('Recipient has no WhatsApp account');
  });

  it('gives a failure a reason even when Meta gave none', () => {
    const message = queued();
    message.advanceTo('failed');
    expect(message.snapshot().failureReason).toBeTruthy();
  });
});

describe('what the bot can and cannot read', () => {
  it('can read words', () => {
    expect(isReadable('text')).toBe(true);
    expect(isReadable('interactive')).toBe(true);
  });

  it('cannot read a voice note, a pin or a sticker', () => {
    expect(isReadable('audio')).toBe(false);
    expect(isReadable('location')).toBe(false);
    expect(isReadable('sticker')).toBe(false);
  });

  it('knows which kinds are worth filing', () => {
    expect(carriesFile('image')).toBe(true);
    expect(carriesFile('document')).toBe(true);
    // A voice note is not a document, whatever it is about.
    expect(carriesFile('audio')).toBe(false);
  });
});

describe('the links back out', () => {
  it('remembers the document an attachment became', () => {
    const message = received({ kind: 'image', body: null, mediaId: 'media-1' });
    message.filedAs('doc-1');
    expect(message.snapshot().documentId).toBe('doc-1');
  });

  it('remembers the contact log entry it produced', () => {
    const message = received();
    message.loggedAs('entry-1');
    expect(message.snapshot().contactLogEntryId).toBe('entry-1');
  });
});
