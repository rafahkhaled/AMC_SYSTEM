import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhook, signatureMatches, verificationChallenge } from './webhook.js';

const SECRET = 'an-app-secret';

/** A payload shaped the way Meta actually sends one. */
function delivery(value: Record<string, unknown>): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '10001', changes: [{ field: 'messages', value }] }],
  };
}

function textMessage(overrides: Record<string, unknown> = {}): unknown {
  return delivery({
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '97141234567', phone_number_id: '55501' },
    contacts: [{ profile: { name: 'Layla Haddad' }, wa_id: '971501234567' }],
    messages: [
      {
        from: '971501234567',
        id: 'wamid.HBgM',
        timestamp: '1789041600',
        type: 'text',
        text: { body: 'متى موعد الإقرار؟' },
        ...overrides,
      },
    ],
  });
}

describe('the signature Meta puts on every delivery', () => {
  it('accepts a body signed with the app secret', () => {
    const rawBody = Buffer.from(JSON.stringify(textMessage()));
    const header = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    expect(signatureMatches({ rawBody, header, appSecret: SECRET })).toBe(true);
  });

  it('refuses a body that was changed after it was signed', () => {
    const rawBody = Buffer.from(JSON.stringify(textMessage()));
    const header = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
    const tampered = Buffer.from(JSON.stringify(textMessage({ from: '971559999999' })));

    // Without this check anybody who learns the URL can post a message that
    // appears to come from any client's number.
    expect(signatureMatches({ rawBody: tampered, header, appSecret: SECRET })).toBe(false);
  });

  it('refuses a signature made with a different secret', () => {
    const rawBody = Buffer.from('{}');
    const header = `sha256=${createHmac('sha256', 'not-the-secret').update(rawBody).digest('hex')}`;
    expect(signatureMatches({ rawBody, header, appSecret: SECRET })).toBe(false);
  });

  it('refuses a missing header, a missing secret and the wrong algorithm', () => {
    const rawBody = Buffer.from('{}');
    const good = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;

    expect(signatureMatches({ rawBody, header: undefined, appSecret: SECRET })).toBe(false);
    expect(signatureMatches({ rawBody, header: good, appSecret: '' })).toBe(false);
    expect(
      signatureMatches({ rawBody, header: good.replace('sha256=', 'sha1='), appSecret: SECRET }),
    ).toBe(false);
  });

  it('refuses a short signature without throwing', () => {
    // timingSafeEqual throws on mismatched lengths, and a throw here would be a
    // 500 rather than a refusal.
    expect(
      signatureMatches({ rawBody: Buffer.from('{}'), header: 'sha256=ab', appSecret: SECRET }),
    ).toBe(false);
    expect(
      signatureMatches({ rawBody: Buffer.from('{}'), header: 'sha256=zz', appSecret: SECRET }),
    ).toBe(false);
  });

  it('signs the exact bytes, so a re-serialised body no longer matches', () => {
    // This is why the raw buffer has to survive JSON parsing: the same data
    // serialised differently produces a different digest.
    const original = '{"a":1, "b":2}';
    const header = `sha256=${createHmac('sha256', SECRET).update(original).digest('hex')}`;
    const reserialised = JSON.stringify(JSON.parse(original));

    expect(signatureMatches({ rawBody: original, header, appSecret: SECRET })).toBe(true);
    expect(signatureMatches({ rawBody: reserialised, header, appSecret: SECRET })).toBe(false);
  });
});

describe("Meta's subscription handshake", () => {
  it('echoes the challenge when the token is right', () => {
    expect(
      verificationChallenge({
        mode: 'subscribe',
        token: 'shared-token',
        challenge: '1158201444',
        verifyToken: 'shared-token',
      }),
    ).toBe('1158201444');
  });

  it('refuses the wrong token, the wrong mode, and no token at all', () => {
    const base = { challenge: 'c', verifyToken: 'shared-token' } as const;
    expect(verificationChallenge({ ...base, mode: 'subscribe', token: 'wrong' })).toBeNull();
    expect(
      verificationChallenge({ ...base, mode: 'unsubscribe', token: 'shared-token' }),
    ).toBeNull();
    expect(verificationChallenge({ ...base, mode: 'subscribe', token: undefined })).toBeNull();
    expect(
      verificationChallenge({ mode: 'subscribe', token: '', challenge: 'c', verifyToken: '' }),
    ).toBeNull();
  });
});

describe('reading a message out of the payload', () => {
  it('reads the words, the sender and the name', () => {
    const { messages } = parseWebhook(textMessage());
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      providerMessageId: 'wamid.HBgM',
      from: '+971501234567',
      profileName: 'Layla Haddad',
      kind: 'text',
      body: 'متى موعد الإقرار؟',
    });
  });

  it('reads the timestamp as seconds, not milliseconds', () => {
    // Passed to new Date unchanged this is 1970, which sorts to the top of every
    // thread and sits outside the service window as permanently expired.
    const { messages } = parseWebhook(textMessage());
    expect(messages[0]?.occurredAt.toISOString()).toBe('2026-09-10T12:00:00.000Z');
  });

  it('falls back to now for a timestamp it cannot read', () => {
    const { messages } = parseWebhook(textMessage({ timestamp: 'not a number' }));
    expect(messages[0]?.occurredAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('puts the plus back on a foreign number', () => {
    const { messages } = parseWebhook(textMessage({ from: '966501234567' }));
    expect(messages[0]?.from).toBe('+966501234567');
  });

  it('keeps the raw entry, for the morning something was handled wrongly', () => {
    const { messages } = parseWebhook(textMessage());
    expect(messages[0]?.raw).toMatchObject({ id: 'wamid.HBgM' });
  });
});

describe('the kinds of message that arrive', () => {
  it('reads an image and its caption', () => {
    const { messages } = parseWebhook(
      textMessage({
        type: 'image',
        text: undefined,
        image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'the trade licence' },
      }),
    );
    expect(messages[0]).toMatchObject({
      kind: 'image',
      mediaId: 'media-1',
      mediaMimeType: 'image/jpeg',
      // The caption is often where the client says what the file actually is.
      body: 'the trade licence',
    });
  });

  it('reads a document and its filename', () => {
    const { messages } = parseWebhook(
      textMessage({
        type: 'document',
        text: undefined,
        document: {
          id: 'media-2',
          mime_type: 'application/pdf',
          filename: 'Bank statement Aug 2026.pdf',
        },
      }),
    );
    expect(messages[0]).toMatchObject({
      kind: 'document',
      mediaId: 'media-2',
      mediaFilename: 'Bank statement Aug 2026.pdf',
    });
  });

  it('reads a button reply, whose words are somewhere else entirely', () => {
    const { messages } = parseWebhook(
      textMessage({
        type: 'interactive',
        text: undefined,
        interactive: { type: 'button_reply', button_reply: { id: 'b2', title: 'Send documents' } },
      }),
    );
    expect(messages[0]).toMatchObject({ kind: 'interactive', body: 'Send documents' });
  });

  it('reads a list reply', () => {
    const { messages } = parseWebhook(
      textMessage({
        type: 'interactive',
        text: undefined,
        interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'My deadlines' } },
      }),
    );
    expect(messages[0]?.body).toBe('My deadlines');
  });

  it('reads a voice note as audio, with no words', () => {
    const { messages } = parseWebhook(
      textMessage({
        type: 'voice',
        text: undefined,
        voice: { id: 'media-3', mime_type: 'audio/ogg' },
      }),
    );
    expect(messages[0]).toMatchObject({ kind: 'audio', body: null, mediaId: 'media-3' });
  });

  it('calls a kind it has never seen unsupported rather than dropping it', () => {
    const { messages, skipped } = parseWebhook(
      textMessage({ type: 'order', text: undefined, order: { catalog_id: '1' } }),
    );
    expect(messages[0]?.kind).toBe('unsupported');
    expect(skipped).toBe(0);
  });
});

describe('delivery status callbacks', () => {
  it('reads them', () => {
    const { statuses } = parseWebhook(
      delivery({
        messaging_product: 'whatsapp',
        statuses: [
          {
            id: 'wamid.out.1',
            status: 'delivered',
            timestamp: '1789041600',
            recipient_id: '971501234567',
          },
        ],
      }),
    );
    expect(statuses[0]).toMatchObject({ providerMessageId: 'wamid.out.1', status: 'delivered' });
  });

  it('reads the reason a message failed', () => {
    const { statuses } = parseWebhook(
      delivery({
        statuses: [
          {
            id: 'wamid.out.2',
            status: 'failed',
            timestamp: '1789041600',
            errors: [{ code: 131_026, title: 'Message undeliverable' }],
          },
        ],
      }),
    );
    expect(statuses[0]).toMatchObject({
      status: 'failed',
      detail: 'Message undeliverable',
    });
  });

  it('skips a status it does not recognise', () => {
    const { statuses, skipped } = parseWebhook(
      delivery({ statuses: [{ id: 'wamid.out.3', status: 'deleted', timestamp: '1789041600' }] }),
    );
    expect(statuses).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('payloads that are not messages', () => {
  it('ignores a change about something else on the same endpoint', () => {
    // Template approvals and account quality updates arrive here too.
    const parsed = parseWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '10001',
          changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }],
        },
      ],
    });
    expect(parsed.messages).toHaveLength(0);
    expect(parsed.statuses).toHaveLength(0);
    expect(parsed.skipped).toBe(0);
  });

  it('survives a payload that is nothing like the shape it expects', () => {
    for (const nonsense of [null, undefined, 42, 'hello', [], {}, { entry: 'not an array' }]) {
      const parsed = parseWebhook(nonsense);
      expect(parsed.messages).toHaveLength(0);
    }
  });

  it('survives a message with the fields that matter missing', () => {
    const { messages, skipped } = parseWebhook(
      delivery({ messages: [{ type: 'text', text: { body: 'hello' } }] }),
    );
    expect(messages).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('reads several messages from one delivery, which Meta does batch', () => {
    const { messages } = parseWebhook(
      delivery({
        contacts: [{ profile: { name: 'Layla' }, wa_id: '971501234567' }],
        messages: [
          {
            from: '971501234567',
            id: 'wamid.a',
            timestamp: '1789041600',
            type: 'text',
            text: { body: 'one' },
          },
          {
            from: '971501234567',
            id: 'wamid.b',
            timestamp: '1789041601',
            type: 'text',
            text: { body: 'two' },
          },
        ],
      }),
    );
    expect(messages.map((m) => m.body)).toEqual(['one', 'two']);
  });
});
