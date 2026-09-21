import { type Clock, type IdGenerator, formatPhone } from '@amc/kernel';
import {
  Conversation,
  type Intent,
  type Language,
  Message,
  type MessageKind,
  type Wording,
  carriesFile,
  isReadable,
  languageOf,
  readIntent,
  replies,
} from '../domain/index.js';
import type {
  ContactDirectory,
  ContactLogWriter,
  ConversationRepository,
  DeadlineReader,
  DocumentFiler,
  InboundMessage,
  MessageRepository,
  PracticeIdentity,
  StaffNotifier,
  StaffPicker,
  WhatsAppTransport,
} from './ports.js';

export type Handled =
  | 'answered'
  | 'filed'
  | 'handed_to_a_person'
  | 'person_is_handling_it'
  | 'opted_out'
  | 'already_had_it'
  | 'unreadable_number';

/** How far ahead the bot looks when somebody asks what they owe. */
const DEADLINE_HORIZON_DAYS = 60;

/**
 * A client wrote to the practice on WhatsApp (PW-03, PW-04, PW-05).
 *
 * The shape of this is one decision, repeated: *does the bot know enough to be
 * useful, and if not, who is the person?* Everything the bot cannot do
 * confidently ends with a named member of staff holding the conversation and
 * knowing they hold it — which is the outcome the client wanted in the first
 * place.
 *
 * Three things are always true, whatever path a message takes:
 *
 *  - The message is stored before anything is decided, so a crash halfway
 *    through leaves a record of what arrived rather than nothing.
 *  - It reaches the contact log, because the contact log is where anybody
 *    already looks to ask what a client was told.
 *  - The bot does not speak if a person has taken the conversation over.
 */
export class ReceiveMessage {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly directory: ContactDirectory,
    private readonly log: ContactLogWriter,
    private readonly documents: DocumentFiler,
    private readonly deadlines: DeadlineReader,
    private readonly staff: StaffPicker,
    private readonly notifier: StaffNotifier,
    private readonly transport: WhatsAppTransport,
    private readonly practice: PracticeIdentity,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async handle(inbound: InboundMessage): Promise<Handled> {
    if (!inbound.from.startsWith('+')) {
      // The adapter could not read the number Meta sent. Nothing useful can be
      // done with it and inventing a conversation for it would put every
      // unreadable number in the same one.
      return 'unreadable_number';
    }

    const now = this.clock.now();
    const conversation = await this.findOrStart(inbound, now);

    const language = languageOf(inbound.body ?? '', conversation.language);
    const stored = Message.received({
      id: this.ids.next(),
      conversationId: conversation.id,
      providerMessageId: inbound.providerMessageId,
      kind: inbound.kind,
      body: inbound.body ?? describe(inbound.kind, language),
      mediaId: inbound.mediaId,
      mediaMimeType: inbound.mediaMimeType,
      mediaFilename: inbound.mediaFilename,
      occurredAt: inbound.occurredAt,
    });
    if (!stored.ok) return 'unreadable_number';

    const outcome = await this.messages.store(stored.value);
    if (outcome === 'already_had_it') {
      // Meta retries a delivery it believes failed, and it retries often. This
      // is the whole of the duplicate handling, and it has to come before any
      // reply: answering twice is what the client actually notices.
      return 'already_had_it';
    }

    conversation.recordInbound({ at: inbound.occurredAt, language });
    await this.writeToContactLog(conversation, stored.value, 'inbound');

    const handled = await this.decide(conversation, stored.value, inbound, language, now);
    await this.conversations.save(conversation);
    return handled;
  }

  /**
   * The conversation this number already has, or a new one.
   *
   * The match against a client happens once, here, and is not retried on every
   * message: a number that was a stranger yesterday and is a client today was
   * made one by somebody identifying the conversation, and re-matching would
   * undo that decision or fight with it.
   */
  private async findOrStart(inbound: InboundMessage, now: Date): Promise<Conversation> {
    const existing = await this.conversations.findByPhone(inbound.from);
    if (existing) return existing;

    const known = await this.directory.whoseNumber(inbound.from);
    const started = Conversation.start({
      id: this.ids.next(),
      phone: inbound.from,
      clientId: known?.clientId ?? null,
      contactId: known?.contactId ?? null,
      profileName: inbound.profileName,
      language: known?.language ?? languageOf(inbound.body ?? '', 'ar'),
      now,
    });
    if (!started.ok) throw new Error(started.error.message);

    await this.conversations.save(started.value);
    return started.value;
  }

  private async decide(
    conversation: Conversation,
    message: Message,
    inbound: InboundMessage,
    language: Language,
    now: Date,
  ): Promise<Handled> {
    /*
     * STOP and START are honoured whoever is handling the conversation.
     *
     * Deliberately before the check below: a client who asks a person to stop
     * messaging them has still asked, and requiring them to ask the bot instead
     * would be absurd.
     */
    const early = readIntent(inbound.body ?? '', conversation.awaiting);
    if (early.kind === 'stop') {
      /*
       * The confirmation goes out first, and then the opt-out takes effect.
       *
       * The other order sends nothing at all: `maySend` refuses everything once
       * somebody has opted out, including the message telling them it worked
       * and how to undo it. The client is left with silence, which reads as the
       * request having been ignored — and they have no way back.
       *
       * The same ordering trap is in `handOver`, for the same reason.
       */
      await this.reply(conversation, replies.STOPPED, language, now);
      conversation.optOut(now);
      return 'opted_out';
    }
    if (early.kind === 'start' && conversation.optedOut) {
      conversation.optBackIn(now);
      await this.reply(conversation, replies.greeting(this.practice.name), language, now);
      conversation.nowAwaiting('menu_choice');
      return 'answered';
    }

    if (!conversation.botMaySpeak) {
      // A person owns this conversation. They are told a message arrived and
      // the bot says nothing at all — a client mid-conversation with their
      // accountant who receives an automatic menu has been told the firm is not
      // listening.
      await this.tellSomebody(conversation, inbound, 'existing');
      return 'person_is_handling_it';
    }

    if (carriesFile(message.kind)) return this.takeTheFile(conversation, message, language, now);

    if (!isReadable(message.kind)) {
      // A voice note, a location pin, a contact card. It does not ask them to
      // type it out instead, which is an imposition when they chose a voice note
      // for a reason.
      return this.handOver(
        conversation,
        inbound,
        replies.CANNOT_READ,
        language,
        now,
        'cannot_read',
      );
    }

    return this.answer(conversation, early, inbound, language, now);
  }

  private async answer(
    conversation: Conversation,
    intent: Intent,
    inbound: InboundMessage,
    language: Language,
    now: Date,
  ): Promise<Handled> {
    /*
     * A number nobody has matched gets a person, not a bot.
     *
     * There is nothing useful the bot can tell somebody whose client it cannot
     * find — it has no deadlines to read out and nowhere to file anything — and
     * the most common reason for an unmatched number is a client writing from a
     * second phone, who is owed a person rather than an apology.
     */
    if (!conversation.clientId) {
      return this.handOver(conversation, inbound, replies.UNRECOGNISED, language, now, 'asked_for');
    }

    switch (intent.kind) {
      case 'greeting': {
        conversation.followed();
        await this.reply(conversation, replies.greeting(this.practice.name), language, now);
        conversation.nowAwaiting('menu_choice');
        return 'answered';
      }

      case 'deadlines': {
        conversation.followed();
        const lines = await this.deadlines.upcomingFor(
          conversation.clientId,
          DEADLINE_HORIZON_DAYS,
        );
        await this.reply(conversation, replies.deadlines(lines), language, now);
        conversation.nowAwaiting(null);
        return 'answered';
      }

      case 'documents': {
        conversation.followed();
        await this.reply(conversation, replies.SEND_DOCUMENTS, language, now);
        conversation.nowAwaiting('documents');
        return 'answered';
      }

      case 'human': {
        conversation.followed();
        return this.handOver(
          conversation,
          inbound,
          replies.HANDING_OVER,
          language,
          now,
          'asked_for',
        );
      }

      case 'thanks': {
        conversation.followed();
        await this.reply(conversation, replies.THANKS, language, now);
        return 'answered';
      }

      case 'start':
      case 'stop':
        // Both were handled before this point. Listed so that adding an intent
        // makes the compiler ask what it should do here.
        return 'answered';

      case 'unclear': {
        if (conversation.didNotFollow() === 'give_up') {
          return this.handOver(
            conversation,
            inbound,
            replies.GIVING_UP,
            language,
            now,
            'bot_gave_up',
          );
        }
        await this.reply(conversation, replies.DID_NOT_FOLLOW, language, now);
        conversation.nowAwaiting('menu_choice');
        return 'answered';
      }
    }
  }

  /**
   * A file arrived.
   *
   * It is fetched and filed before the client is told anything, so "received"
   * is only ever said about a document the practice actually holds. The other
   * order gives the client a confirmation for a file that was lost, and they
   * will hold the practice to it when the filing is late.
   */
  private async takeTheFile(
    conversation: Conversation,
    message: Message,
    language: Language,
    now: Date,
  ): Promise<Handled> {
    const state = message.snapshot();
    if (!state.mediaId) return 'answered';

    if (!conversation.clientId) {
      /*
       * Nowhere to file it. The media id stays on the message, so once somebody
       * identifies the conversation the file can still be fetched — Meta holds
       * media for a limited time, which is why the unmatched queue is a screen
       * somebody is expected to look at and not an archive.
       */
      await this.reply(conversation, replies.DOCUMENT_FROM_STRANGER, language, now);
      const picked = await this.staff.onDuty();
      if (picked) conversation.takeOver({ userId: picked.userId, reason: 'staff_chose', now });
      return 'handed_to_a_person';
    }

    const fetched = await this.transport.fetchMedia(state.mediaId);
    if (!fetched.ok) {
      await this.reply(conversation, replies.CANNOT_READ, language, now);
      const picked = await this.staff.forClient(conversation.clientId);
      if (picked) {
        conversation.takeOver({ userId: picked.userId, reason: 'cannot_read', now });
      }
      return 'handed_to_a_person';
    }

    const filed = await this.documents.file({
      clientId: conversation.clientId,
      filename:
        state.mediaFilename ??
        fetched.value.filename ??
        fallbackName(state.id, fetched.value.contentType),
      contentType: fetched.value.contentType,
      body: fetched.value.body,
    });
    if (!filed.ok) {
      await this.reply(conversation, replies.CANNOT_READ, language, now);
      const picked = await this.staff.forClient(conversation.clientId);
      if (picked) {
        conversation.takeOver({ userId: picked.userId, reason: 'cannot_read', now });
      }
      return 'handed_to_a_person';
    }

    message.filedAs(filed.value.documentId);
    await this.messages.save(message);

    conversation.followed();
    await this.reply(conversation, replies.documentReceived(state.mediaFilename), language, now);
    return 'filed';
  }

  /** Every path that ends with a person holding the conversation. */
  private async handOver(
    conversation: Conversation,
    inbound: InboundMessage,
    wording: Wording,
    language: Language,
    now: Date,
    reason: 'asked_for' | 'bot_gave_up' | 'cannot_read',
  ): Promise<Handled> {
    // The reply goes out before the takeover, because after it the bot may not
    // speak — including to say that it is fetching somebody.
    await this.reply(conversation, wording, language, now);

    const picked =
      (await this.staff.forClient(conversation.clientId)) ?? (await this.staff.onDuty());
    if (picked) {
      conversation.takeOver({ userId: picked.userId, reason, now });
      await this.tellSomebody(conversation, inbound, picked.userId);
    }
    return 'handed_to_a_person';
  }

  /**
   * Telling a member of staff a conversation is waiting.
   *
   * `who` is either a user id or 'existing', meaning whoever already holds it.
   * A failure here is swallowed: the conversation is already assigned, which is
   * the record that somebody owns it, and losing that over a notification is
   * the worse trade.
   */
  private async tellSomebody(
    conversation: Conversation,
    inbound: InboundMessage,
    who: string | 'existing',
  ): Promise<void> {
    const userId = who === 'existing' ? conversation.assignedUserId : who;
    if (!userId) return;

    try {
      await this.notifier.conversationNeedsYou({
        userId,
        conversationId: conversation.id,
        clientId: conversation.clientId,
        phone: formatPhone(conversation.phone),
        said: (inbound.body ?? '').slice(0, 300),
      });
    } catch {
      // Left untold. The conversation is assigned and shows on their screen.
    }
  }

  /** Sends one reply, writes it down, and logs it. */
  private async reply(
    conversation: Conversation,
    wording: Wording,
    language: Language,
    now: Date,
  ): Promise<void> {
    const body = wording[language];
    const allowed = conversation.maySend({ kind: 'text', body }, now);
    if (!allowed.ok) return;

    const queued = Message.queued({
      id: this.ids.next(),
      conversationId: conversation.id,
      body,
      occurredAt: now,
    });
    if (!queued.ok) return;
    await this.messages.store(queued.value);

    const sent = await this.transport.sendText({ to: conversation.phone, body });
    if (sent.ok) {
      queued.value.accepted(sent.value.providerMessageId);
      conversation.recordOutbound(now);
    } else {
      queued.value.advanceTo('failed', sent.error.message);
    }
    await this.messages.save(queued.value);
    await this.writeToContactLog(conversation, queued.value, 'outbound');
  }

  /**
   * Every message, in both directions, reaches the contact log.
   *
   * Only when the client is known, because the log is per-client and there is
   * nowhere to put a stranger's message. That is the other reason the unmatched
   * queue matters: until somebody identifies the conversation, those messages
   * exist only in the WhatsApp tables.
   */
  private async writeToContactLog(
    conversation: Conversation,
    message: Message,
    direction: 'inbound' | 'outbound',
  ): Promise<void> {
    if (!conversation.clientId) return;
    const state = message.snapshot();

    try {
      const entryId = await this.log.record({
        clientId: conversation.clientId,
        direction,
        happenedAt: state.occurredAt,
        summary: summarise(state.body, state.mediaFilename, direction, message.sentByBot),
        contactId: conversation.contactId,
      });
      if (entryId) {
        message.loggedAs(entryId);
        await this.messages.save(message);
      }
    } catch {
      // The message is stored either way. A contact log entry that failed to
      // write is worth less than the message it describes.
    }
  }
}

/**
 * The one-line summary in the contact log.
 *
 * It says who spoke, because "the client was told their return is due on the
 * 28th" and "the bot told the client their return is due on the 28th" are
 * different facts when somebody is working out how a misunderstanding started.
 */
function summarise(
  body: string | null,
  filename: string | null,
  direction: 'inbound' | 'outbound',
  fromBot: boolean,
): string {
  const who =
    direction === 'inbound'
      ? 'WhatsApp from client'
      : fromBot
        ? 'WhatsApp (automatic)'
        : 'WhatsApp';
  const what = body?.trim() || (filename ? `sent a file: ${filename}` : 'sent a file');
  return `${who}: ${what}`.slice(0, 2000);
}

/** A short description of a message with no words, so the thread is readable. */
function describe(kind: MessageKind, language: Language): string {
  const words: Partial<Record<MessageKind, { en: string; ar: string }>> = {
    audio: { en: '[voice note]', ar: '[رسالة صوتية]' },
    video: { en: '[video]', ar: '[فيديو]' },
    sticker: { en: '[sticker]', ar: '[ملصق]' },
    location: { en: '[location]', ar: '[موقع]' },
    contacts: { en: '[contact card]', ar: '[بطاقة اتصال]' },
    image: { en: '[image]', ar: '[صورة]' },
    document: { en: '[file]', ar: '[ملف]' },
  };
  return words[kind]?.[language] ?? (language === 'ar' ? '[رسالة]' : '[message]');
}

/** A name for a file Meta sent without one, which is most photographs. */
function fallbackName(messageId: string, contentType: string): string {
  const extension = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
  return `whatsapp-${messageId}.${extension}`;
}
