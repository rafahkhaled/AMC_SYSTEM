import { Conflict } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { replies } from '../domain/index.js';
import type { InboundMessage } from './ports.js';
import { ReceiveMessage } from './receive-message.js';
import {
  CountingIds,
  FakeClock,
  FakeDeadlines,
  FakeDirectory,
  FakeStaff,
  FakeTransport,
  InMemoryConversations,
  InMemoryMessages,
  PRACTICE,
  RecordingContactLog,
  RecordingFiler,
  RecordingNotifier,
} from './test-doubles.js';

const CLIENT_PHONE = '+971501234567';
const STRANGER = '+971559876543';
const now = new Date('2026-09-19T10:00:00.000Z');

interface Harness {
  handle(inbound: Partial<InboundMessage>): Promise<string>;
  conversations: InMemoryConversations;
  messages: InMemoryMessages;
  log: RecordingContactLog;
  filer: RecordingFiler;
  notifier: RecordingNotifier;
  transport: FakeTransport;
  clock: FakeClock;
}

function harness(
  build: (parts: {
    directory: FakeDirectory;
    deadlines: FakeDeadlines;
    filer: RecordingFiler;
    transport: FakeTransport;
    notifier: RecordingNotifier;
  }) => {
    directory?: FakeDirectory;
    staff?: FakeStaff;
  } = () => ({}),
): Harness {
  const directory = new FakeDirectory().knows(CLIENT_PHONE, {
    clientId: 'c-1',
    contactId: 'k-1',
    language: 'en',
  });
  const deadlines = new FakeDeadlines();
  const filer = new RecordingFiler();
  const transport = new FakeTransport();
  const notifier = new RecordingNotifier();
  const chosen = build({ directory, deadlines, filer, transport, notifier });

  const conversations = new InMemoryConversations();
  const messages = new InMemoryMessages();
  const log = new RecordingContactLog();
  const clock = new FakeClock(now);

  const receive = new ReceiveMessage(
    conversations,
    messages,
    chosen.directory ?? directory,
    log,
    filer,
    deadlines,
    chosen.staff ?? new FakeStaff({ 'c-1': 'u-accountant' }, 'u-duty'),
    notifier,
    transport,
    PRACTICE,
    clock,
    new CountingIds(),
  );

  let n = 0;
  return {
    conversations,
    messages,
    log,
    filer,
    notifier,
    transport,
    clock,
    async handle(inbound) {
      n += 1;
      return receive.handle({
        providerMessageId: `wamid.in.${n}`,
        from: CLIENT_PHONE,
        profileName: 'Layla',
        kind: 'text',
        body: 'hello',
        mediaId: null,
        mediaMimeType: null,
        mediaFilename: null,
        occurredAt: clock.now(),
        ...inbound,
      });
    },
  };
}

describe('a known client writing in', () => {
  it('greets them and offers the menu', async () => {
    const h = harness();
    expect(await h.handle({ body: 'hello' })).toBe('answered');
    expect(h.transport.sentText[0]?.body).toContain('Active Management Consultancy');
    expect(h.transport.sentText[0]?.body).toContain('1 — My deadlines');
  });

  it('answers in Arabic when they wrote Arabic', async () => {
    const h = harness();
    await h.handle({ body: 'السلام عليكم' });
    expect(h.transport.sentText[0]?.body).toContain('أهلاً وسهلاً');
  });

  it('reads their next bare number as a menu choice', async () => {
    const h = harness();
    await h.handle({ body: 'hello' });
    expect(await h.handle({ body: '2' })).toBe('answered');
    expect(h.transport.sentText[1]?.body).toBe(replies.SEND_DOCUMENTS.en);
  });

  it('reads out what they owe', async () => {
    const h = harness();
    await h.handle({ body: 'hello' });
    await h.handle({ body: '1' });
    // Nothing was loaded into the deadline reader, so it says so plainly rather
    // than saying nothing.
    expect(h.transport.sentText[1]?.body).toBe(replies.NO_DEADLINES.en);
  });

  it('thanks them back without offering the menu again', async () => {
    const h = harness();
    expect(await h.handle({ body: 'thanks!' })).toBe('answered');
    expect(h.transport.sentText[0]?.body).toBe(replies.THANKS.en);
  });
});

describe('the deadlines it reads out', () => {
  it('lists them in the language they asked in', async () => {
    let reader: FakeDeadlines | undefined;
    const h = harness(({ deadlines }) => {
      reader = deadlines.returning([
        {
          label: { en: 'VAT return, Q3', ar: 'الإقرار الضريبي، الربع الثالث' },
          dueOn: { en: '28 October 2026', ar: '٢٨ أكتوبر ٢٠٢٦' },
          overdue: false,
        },
      ]);
      return {};
    });
    expect(reader).toBeDefined();

    await h.handle({ body: 'متى موعد الإقرار؟' });
    const said = h.transport.sentText[0]?.body ?? '';
    expect(said).toContain('الإقرار الضريبي، الربع الثالث');

    /*
     * The date in Arabic too, not only the words around it.
     *
     * This read `28 Oct 2026` until the bot was run against a real client, and
     * the message that came out was `• الإقرار الضريبي — بتاريخ 28 August 2026`
     * — the half of the sentence nobody had thought of as language sitting in
     * the middle of the half that was.
     */
    expect(said).toContain('٢٨ أكتوبر ٢٠٢٦');
    expect(said).not.toContain('28 October 2026');
  });

  it('answers in English with the English date', async () => {
    const h = harness(({ deadlines }) => {
      deadlines.returning([
        {
          label: { en: 'VAT return, Q3', ar: 'الإقرار الضريبي، الربع الثالث' },
          dueOn: { en: '28 October 2026', ar: '٢٨ أكتوبر ٢٠٢٦' },
          overdue: false,
        },
      ]);
      return {};
    });

    await h.handle({ body: 'when is my VAT return due?' });
    const said = h.transport.sentText[0]?.body ?? '';
    expect(said).toContain('VAT return, Q3');
    expect(said).toContain('28 October 2026');
    expect(said).not.toContain('٢٨ أكتوبر ٢٠٢٦');
  });

  it('says outright when something is already late', async () => {
    const h = harness(({ deadlines }) => {
      deadlines.returning([
        {
          label: { en: 'VAT return, Q3', ar: 'الإقرار الضريبي، الربع الثالث' },
          dueOn: { en: '28 August 2026', ar: '٢٨ أغسطس ٢٠٢٦' },
          overdue: true,
        },
      ]);
      return {};
    });

    await h.handle({ body: 'when is my VAT return due?' });
    const said = h.transport.sentText[0]?.body ?? '';
    // "Due 28 August" on the 21st of September is true and useless, and it
    // makes the practice's own chasing sound routine.
    expect(said).toContain('was due');
    expect(said).toContain('overdue');
  });

  it('says it in Arabic too', async () => {
    const h = harness(({ deadlines }) => {
      deadlines.returning([
        {
          label: { en: 'VAT return, Q3', ar: 'الإقرار الضريبي، الربع الثالث' },
          dueOn: { en: '28 August 2026', ar: '٢٨ أغسطس ٢٠٢٦' },
          overdue: true,
        },
      ]);
      return {};
    });

    await h.handle({ body: 'متى موعد الإقرار؟' });
    const said = h.transport.sentText[0]?.body ?? '';
    expect(said).toContain('كان مستحقاً بتاريخ');
    expect(said).toContain('متأخر');
  });
});

describe('a message from a number nobody recognises', () => {
  it('does not guess who they are', async () => {
    const h = harness();
    expect(await h.handle({ from: STRANGER, body: 'hello' })).toBe('handed_to_a_person');
    expect(h.conversations.only().clientId).toBeNull();
  });

  it('says a person will read it, rather than that they are not a client', async () => {
    const h = harness();
    await h.handle({ from: STRANGER, body: 'hello' });
    expect(h.transport.sentText[0]?.body).toBe(replies.UNRECOGNISED.en);
  });

  it('gives it to whoever is on duty, and tells them', async () => {
    const h = harness();
    await h.handle({ from: STRANGER, body: 'hello' });
    expect(h.conversations.only().assignedUserId).toBe('u-duty');
    expect(h.notifier.told[0]).toMatchObject({ userId: 'u-duty' });
  });

  it('writes nothing to the contact log, because there is no client to write it against', async () => {
    const h = harness();
    await h.handle({ from: STRANGER, body: 'hello' });
    expect(h.log.entries).toHaveLength(0);
  });
});

describe('asking for a person', () => {
  it("hands it to the client's own accountant, not whoever is free", async () => {
    const h = harness();
    expect(await h.handle({ body: 'can I speak to someone please' })).toBe('handed_to_a_person');
    expect(h.conversations.only().assignedUserId).toBe('u-accountant');
  });

  it('falls back to whoever is on duty when the client has nobody assigned', async () => {
    const h = harness(() => ({ staff: new FakeStaff({}, 'u-duty') }));
    await h.handle({ body: 'call me' });
    expect(h.conversations.only().assignedUserId).toBe('u-duty');
  });

  it('tells them what the client said, so they do not have to open a screen to find out', async () => {
    const h = harness();
    await h.handle({ body: 'I need to talk to my accountant about the fine' });
    expect(h.notifier.told[0]?.said).toContain('about the fine');
  });

  it('promises a reply and not a time', async () => {
    const h = harness();
    await h.handle({ body: 'call me' });
    // Nine o'clock on a Friday night is exactly when a promised hour becomes a
    // complaint.
    expect(h.transport.sentText[0]?.body).toBe(replies.HANDING_OVER.en);
    expect(h.transport.sentText[0]?.body).not.toMatch(/hour|minute|today/i);
  });
});

describe('once a person is handling it', () => {
  it('says nothing at all', async () => {
    const h = harness();
    await h.handle({ body: 'can I speak to someone' });
    const saidSoFar = h.transport.sentText.length;

    expect(await h.handle({ body: 'hello? anyone there?' })).toBe('person_is_handling_it');
    // A client mid-conversation with their accountant who receives an automatic
    // menu has been told the firm is not listening.
    expect(h.transport.sentText).toHaveLength(saidSoFar);
  });

  it('still records what the client said', async () => {
    const h = harness();
    await h.handle({ body: 'can I speak to someone' });
    await h.handle({ body: 'it is about the October return' });

    const inbound = h.messages.stored
      .filter((m) => m.snapshot().direction === 'inbound')
      .map((m) => m.snapshot().body);
    expect(inbound).toContain('it is about the October return');
  });

  it('nudges the person holding it rather than the duty desk', async () => {
    const h = harness();
    await h.handle({ body: 'can I speak to someone' });
    h.notifier.told.length = 0;
    await h.handle({ body: 'still waiting' });
    expect(h.notifier.told[0]?.userId).toBe('u-accountant');
  });
});

describe('when the bot cannot follow', () => {
  it('asks once, then fetches a person', async () => {
    const h = harness();
    expect(await h.handle({ body: 'the lease was signed in Sharjah' })).toBe('answered');
    expect(h.transport.sentText[0]?.body).toBe(replies.DID_NOT_FOLLOW.en);

    expect(await h.handle({ body: 'about the second floor' })).toBe('handed_to_a_person');
    expect(h.transport.sentText[1]?.body).toBe(replies.GIVING_UP.en);
  });

  it('forgives one odd message when it understands the next', async () => {
    const h = harness();
    await h.handle({ body: 'the lease was signed in Sharjah' });
    await h.handle({ body: 'thanks' });
    // The streak restarts, so this is the first failure again and not the
    // second.
    expect(await h.handle({ body: 'about the second floor' })).toBe('answered');
  });

  it('fetches a person for a voice note rather than asking them to type', async () => {
    const h = harness();
    expect(await h.handle({ kind: 'audio', body: null, mediaId: 'media-9' })).toBe(
      'handed_to_a_person',
    );
    expect(h.transport.sentText[0]?.body).toBe(replies.CANNOT_READ.en);
  });

  it('keeps a readable record of a message with no words', async () => {
    const h = harness();
    await h.handle({ kind: 'audio', body: null, mediaId: 'media-9' });
    expect(h.messages.stored[0]?.snapshot().body).toBe('[voice note]');
  });
});

describe('a file arriving', () => {
  it('files it against the client and confirms it', async () => {
    const h = harness();
    expect(
      await h.handle({
        kind: 'image',
        body: null,
        mediaId: 'media-1',
        mediaFilename: 'licence.jpg',
      }),
    ).toBe('filed');

    expect(h.filer.filed[0]).toMatchObject({ clientId: 'c-1', filename: 'licence.jpg' });
    expect(h.transport.sentText[0]?.body).toContain('Received (licence.jpg)');
  });

  it('invents a name for the photographs that arrive without one', async () => {
    const h = harness();
    await h.handle({ kind: 'image', body: null, mediaId: 'media-1' });
    expect(h.filer.filed[0]?.filename).toMatch(/^whatsapp-.*\.jpeg$/);
  });

  it('records which document the message became', async () => {
    const h = harness();
    await h.handle({ kind: 'image', body: null, mediaId: 'media-1' });
    const message = h.messages.stored.find((m) => m.snapshot().kind === 'image');
    expect(message?.snapshot().documentId).toBe('doc-1');
  });

  it('does not say "received" when the file could not be fetched', async () => {
    const h = harness(({ transport }) => {
      transport.mediaWillFail(new Conflict('Meta no longer holds that media'));
      return {};
    });
    expect(await h.handle({ kind: 'document', body: null, mediaId: 'media-1' })).toBe(
      'handed_to_a_person',
    );
    // Confirming a file the practice does not hold is the one thing a client
    // will hold them to when the filing is late.
    expect(h.transport.sentText[0]?.body).not.toContain('Received');
    expect(h.filer.filed).toHaveLength(0);
  });

  it('does not say "received" when the filing itself failed', async () => {
    const h = harness(({ filer }) => {
      filer.willFail(new Conflict('storage is unreachable'));
      return {};
    });
    expect(await h.handle({ kind: 'image', body: null, mediaId: 'media-1' })).toBe(
      'handed_to_a_person',
    );
    expect(h.transport.sentText[0]?.body).not.toContain('Received');
  });

  it("holds a stranger's file for a person instead of filing it nowhere", async () => {
    const h = harness();
    expect(await h.handle({ from: STRANGER, kind: 'image', body: null, mediaId: 'media-1' })).toBe(
      'handed_to_a_person',
    );
    expect(h.filer.filed).toHaveLength(0);
    // Arabic, because a photograph with no words says nothing about which
    // language they read and this is a practice in Dubai.
    expect(h.transport.sentText[0]?.body).toBe(replies.DOCUMENT_FROM_STRANGER.ar);
    // The media id survives, so the file can still be fetched once somebody
    // says whose it is.
    expect(h.messages.stored[0]?.snapshot().mediaId).toBe('media-1');
  });
});

describe('STOP and START', () => {
  it('stops automatic messages, and says how to undo it', async () => {
    const h = harness();
    expect(await h.handle({ body: 'STOP' })).toBe('opted_out');
    // The confirmation has to go out before the opt-out takes effect, or the
    // client is left with silence and no way to undo it.
    expect(h.transport.sentText[0]?.body).toContain('START');
    expect(h.conversations.only().optedOut).toBe(true);
  });

  it('is honoured even while a person is handling the conversation', async () => {
    const h = harness();
    await h.handle({ body: 'can I speak to someone' });
    expect(await h.handle({ body: 'stop messaging me' })).toBe('opted_out');
  });

  it('does not answer them again afterwards', async () => {
    const h = harness();
    await h.handle({ body: 'STOP' });
    const saidSoFar = h.transport.sentText.length;
    await h.handle({ body: 'hello' });
    expect(h.transport.sentText).toHaveLength(saidSoFar);
  });

  it('starts again on START', async () => {
    const h = harness();
    await h.handle({ body: 'STOP' });
    expect(await h.handle({ body: 'START' })).toBe('answered');
    expect(h.conversations.only().optedOut).toBe(false);
  });
});

describe('a webhook Meta sent twice', () => {
  it('is answered once', async () => {
    const h = harness();
    await h.handle({ body: 'hello', providerMessageId: 'wamid.same' });
    const saidSoFar = h.transport.sentText.length;

    const again = await h.handle({ body: 'hello', providerMessageId: 'wamid.same' });
    expect(again).toBe('already_had_it');
    // Answering twice is the part the client actually notices.
    expect(h.transport.sentText).toHaveLength(saidSoFar);
  });

  it('does not write a second contact log entry either', async () => {
    const h = harness();
    await h.handle({ body: 'hello', providerMessageId: 'wamid.same' });
    const entries = h.log.entries.length;
    await h.handle({ body: 'hello', providerMessageId: 'wamid.same' });
    expect(h.log.entries).toHaveLength(entries);
  });
});

describe('the contact log', () => {
  it('records both sides of the conversation', async () => {
    const h = harness();
    await h.handle({ body: 'hello' });
    expect(h.log.entries.map((entry) => entry.direction)).toEqual(['inbound', 'outbound']);
  });

  it('says when the bot was the one talking', async () => {
    const h = harness();
    await h.handle({ body: 'hello' });
    const outbound = h.log.entries.find((entry) => entry.direction === 'outbound');
    // "The client was told" and "the bot told the client" are different facts
    // when somebody is working out how a misunderstanding started.
    expect(outbound?.summary).toContain('automatic');
  });

  it('records what the client actually wrote', async () => {
    const h = harness();
    await h.handle({ body: 'when is my VAT due?' });
    expect(h.log.entries[0]?.summary).toContain('when is my VAT due?');
  });
});

describe('when the world is broken', () => {
  it('records the reply as failed rather than losing it', async () => {
    const h = harness(({ transport }) => {
      transport.textWillFail(new Conflict('WhatsApp is unreachable'));
      return {};
    });
    await h.handle({ body: 'hello' });

    const outbound = h.messages.stored.filter((m) => m.snapshot().direction === 'outbound');
    expect(outbound[0]?.status).toBe('failed');
    expect(outbound[0]?.snapshot().failureReason).toContain('unreachable');
  });

  it('still assigns the conversation when the notifier is down', async () => {
    const h = harness(({ notifier }) => {
      notifier.willThrow();
      return {};
    });
    await h.handle({ body: 'can I speak to someone' });
    // The assignment is the record that somebody owns it; the notification is
    // a convenience on top.
    expect(h.conversations.only().assignedUserId).toBe('u-accountant');
  });

  it('refuses a number it could not read rather than inventing a conversation', async () => {
    const h = harness();
    expect(await h.handle({ from: 'not a number' })).toBe('unreadable_number');
    expect(h.conversations.saved).toHaveLength(0);
  });
});
