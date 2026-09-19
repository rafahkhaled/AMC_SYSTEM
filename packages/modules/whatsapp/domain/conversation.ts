import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';
import type { Awaiting, Language } from './intent.js';
import { UNCLEAR_LIMIT } from './replies.js';
import {
  type OutboundShape,
  type WindowState,
  mayBeSent,
  windowStateAt,
} from './service-window.js';

/** Who is answering this conversation. */
export type Handling = 'bot' | 'human' | 'closed';

export interface ConversationState {
  readonly id: string;
  /** Already reduced to E.164 before it got here. */
  readonly phone: string;
  readonly clientId: string | null;
  readonly contactId: string | null;
  readonly profileName: string | null;
  readonly language: Language;
  readonly handling: Handling;
  readonly assignedUserId: string | null;
  readonly awaiting: Awaiting;
  readonly unclearStreak: number;
  /** When they asked not to be messaged automatically. */
  readonly optedOutAt: Date | null;
  readonly lastInboundAt: Date | null;
  readonly lastOutboundAt: Date | null;
  readonly createdAt: Date;
}

/**
 * One conversation with one phone number (PW-02).
 *
 * The state worth having in one place is *who is answering*. A conversation is
 * handled by the bot, or by a named person who took it over, or by nobody
 * because it was closed — and the bot must never speak into a conversation a
 * person has taken over. That is not a nicety: a client who has just been told
 * "I'll look into this and come back to you" and then receives an automatic
 * menu has been told the firm is not listening.
 *
 * So every automatic reply goes through `botMaySpeak`, and there is no other
 * way to send one.
 */
export class Conversation extends AggregateRoot {
  private constructor(private state: ConversationState) {
    super(state.id);
  }

  static rehydrate(state: ConversationState): Conversation {
    return new Conversation(state);
  }

  /**
   * A number writing in for the first time.
   *
   * The client may be unknown, and stays unknown rather than being guessed at.
   * An unmatched conversation is a real and common thing — a client writing
   * from a second phone, a new enquiry, somebody's accountant in Sharjah — and
   * all of them are better served by a person than by a wrong match.
   */
  static start(params: {
    id: string;
    phone: string;
    clientId?: string | null;
    contactId?: string | null;
    profileName?: string | null;
    language: Language;
    now: Date;
  }): Result<Conversation, Conflict> {
    if (!params.phone.startsWith('+')) {
      // A caller that has not reduced the number will otherwise create a
      // second conversation for a phone that already has one.
      return err(new Conflict('A conversation needs a number in E.164 form'));
    }
    if (params.contactId && !params.clientId) {
      return err(new Conflict('A contact belongs to a client, so name the client too'));
    }

    const conversation = new Conversation({
      id: params.id,
      phone: params.phone,
      clientId: params.clientId ?? null,
      contactId: params.contactId ?? null,
      profileName: params.profileName ?? null,
      language: params.language,
      handling: 'bot',
      assignedUserId: null,
      awaiting: null,
      unclearStreak: 0,
      optedOutAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      createdAt: params.now,
    });

    conversation.record(
      domainEvent('whatsapp.conversation.started', params.id, params.now, {
        conversationId: params.id,
        clientId: conversation.state.clientId,
        matched: conversation.state.clientId !== null,
      }),
    );
    return ok(conversation);
  }

  get clientId(): string | null {
    return this.state.clientId;
  }

  get contactId(): string | null {
    return this.state.contactId;
  }

  get phone(): string {
    return this.state.phone;
  }

  get language(): Language {
    return this.state.language;
  }

  get handling(): Handling {
    return this.state.handling;
  }

  get awaiting(): Awaiting {
    return this.state.awaiting;
  }

  get assignedUserId(): string | null {
    return this.state.assignedUserId;
  }

  get lastInboundAt(): Date | null {
    return this.state.lastInboundAt;
  }

  get optedOut(): boolean {
    return this.state.optedOutAt !== null;
  }

  windowAt(now: Date): WindowState {
    return windowStateAt(this.state.lastInboundAt, now);
  }

  /**
   * Whether the bot may answer at all.
   *
   * False once a person has taken over, and false once the conversation is
   * closed. Both are the same rule from the client's side: somebody decided
   * this conversation is not the bot's, and nothing the client writes
   * afterwards undoes that decision except a person handing it back.
   */
  get botMaySpeak(): boolean {
    return this.state.handling === 'bot';
  }

  /** A message arrived. This is what opens the service window. */
  recordInbound(params: { at: Date; language: Language }): void {
    this.state = {
      ...this.state,
      lastInboundAt: params.at,
      language: params.language,
      /*
       * A conversation the bot had given up on is not reopened by the client
       * writing again — a person still owns it — but a closed one is, because
       * closed means "nothing outstanding", not "do not speak to us".
       *
       * An opt-out is the exception: somebody who typed STOP and then writes
       * "one more thing" has not withdrawn the STOP, and answering them with
       * the bot would be reading a message as consent it does not give. Only
       * START withdraws it.
       */
      handling:
        this.state.handling === 'closed' && !this.state.optedOutAt ? 'bot' : this.state.handling,
    };
  }

  recordOutbound(at: Date): void {
    this.state = { ...this.state, lastOutboundAt: at };
  }

  /** What the bot has just asked for, so the next message answers it. */
  nowAwaiting(awaiting: Awaiting): void {
    this.state = { ...this.state, awaiting };
  }

  /**
   * The bot did not understand.
   *
   * Returns whether it should stop trying. Two in a row is the limit: a third
   * "sorry, I didn't follow that" has spent the client's patience and produced
   * nothing.
   */
  didNotFollow(): 'ask_again' | 'give_up' {
    const streak = this.state.unclearStreak + 1;
    this.state = { ...this.state, unclearStreak: streak };
    return streak >= UNCLEAR_LIMIT ? 'give_up' : 'ask_again';
  }

  /** Understood something. The streak resets, so an odd message is forgiven. */
  followed(): void {
    if (this.state.unclearStreak !== 0) this.state = { ...this.state, unclearStreak: 0 };
  }

  /**
   * A person takes it over, whether they chose to or the bot fetched them.
   *
   * `reason` is carried on the event rather than stored, because the useful
   * question later is "how often does the bot give up", which is a question
   * about events over time and not about the current state of one conversation.
   */
  takeOver(params: {
    userId: string;
    reason: 'asked_for' | 'bot_gave_up' | 'staff_chose' | 'cannot_read';
    now: Date;
  }): Result<void, Conflict> {
    if (this.state.handling === 'human' && this.state.assignedUserId === params.userId) {
      return ok(undefined);
    }

    const previous = this.state.assignedUserId;
    this.state = {
      ...this.state,
      handling: 'human',
      assignedUserId: params.userId,
      // Whatever the bot was waiting for no longer applies: a person is
      // reading this now and a stale "I asked for a menu choice" would make
      // the client's next message be read as one.
      awaiting: null,
      unclearStreak: 0,
    };

    this.record(
      domainEvent('whatsapp.conversation.taken_over', this.id, params.now, {
        conversationId: this.id,
        clientId: this.state.clientId,
        userId: params.userId,
        previousUserId: previous,
        reason: params.reason,
      }),
    );
    return ok(undefined);
  }

  /**
   * A person hands it back to the bot.
   *
   * Only from `human`, and deliberately not from `closed`: handing back a
   * closed conversation is reopening it, which is `start` again from the
   * client's side and not something staff need to do.
   */
  handBack(now: Date): Result<void, Conflict> {
    if (this.state.handling !== 'human') {
      return err(new Conflict('This conversation is not with a person'));
    }
    const was = this.state.assignedUserId;
    this.state = { ...this.state, handling: 'bot', assignedUserId: null, awaiting: null };
    this.record(
      domainEvent('whatsapp.conversation.handed_back', this.id, now, {
        conversationId: this.id,
        clientId: this.state.clientId,
        previousUserId: was,
      }),
    );
    return ok(undefined);
  }

  /**
   * They asked not to be messaged automatically.
   *
   * This stops templates as well as free text, which is the whole difference
   * between it and closing. A client who typed STOP and then received the next
   * automatic reminder anyway has been ignored, and in this country that is
   * also a regulatory problem and not only a rude one.
   *
   * It does not stop a person writing to them.
   */
  optOut(now: Date): void {
    if (this.state.optedOutAt) return;
    this.state = {
      ...this.state,
      optedOutAt: now,
      handling: 'closed',
      assignedUserId: null,
      awaiting: null,
    };
    this.record(
      domainEvent('whatsapp.conversation.opted_out', this.id, now, {
        conversationId: this.id,
        clientId: this.state.clientId,
      }),
    );
  }

  /** They changed their mind, which is why STOP is always reversible. */
  optBackIn(now: Date): void {
    if (!this.state.optedOutAt) return;
    this.state = { ...this.state, optedOutAt: null, handling: 'bot' };
    this.record(
      domainEvent('whatsapp.conversation.opted_back_in', this.id, now, {
        conversationId: this.id,
        clientId: this.state.clientId,
      }),
    );
  }

  /** Nothing outstanding. Not an opt-out: the client writing again reopens it. */
  close(now: Date): void {
    if (this.state.handling === 'closed') return;
    this.state = { ...this.state, handling: 'closed', assignedUserId: null, awaiting: null };
    this.record(
      domainEvent('whatsapp.conversation.closed', this.id, now, {
        conversationId: this.id,
        clientId: this.state.clientId,
      }),
    );
  }

  /**
   * The number has been matched to a client — usually because somebody looked
   * at the unmatched conversation and said who it was.
   *
   * Once set it is not silently changed. A conversation already attached to a
   * client and then reattached to another would move a filed document to the
   * wrong company, so that has to be a deliberate, separate act.
   */
  identify(params: {
    clientId: string;
    contactId?: string | null;
    now: Date;
  }): Result<void, Conflict> {
    if (this.state.clientId && this.state.clientId !== params.clientId) {
      return err(new Conflict('This conversation is already attached to another client'));
    }

    this.state = {
      ...this.state,
      clientId: params.clientId,
      contactId: params.contactId ?? this.state.contactId,
    };
    this.record(
      domainEvent('whatsapp.conversation.identified', this.id, params.now, {
        conversationId: this.id,
        clientId: params.clientId,
        contactId: this.state.contactId,
      }),
    );
    return ok(undefined);
  }

  /** Whether this may go out now, by Meta's rule and by ours. */
  maySend(shape: OutboundShape, now: Date): Result<void, Conflict> {
    if (this.state.optedOutAt) {
      // Nothing automatic, of either shape. A person writing to them goes
      // through `sendAsPerson`, which is a different question.
      return err(new Conflict('This client asked not to receive automatic WhatsApp messages'));
    }
    if (this.state.handling === 'closed' && shape.kind === 'text') {
      // A closed conversation can still be chased by template — that is how a
      // chase starts — but free text into one means somebody is typing at a
      // conversation nobody is holding.
      return err(new Conflict('This conversation is closed'));
    }
    return mayBeSent(shape, this.state.lastInboundAt, now);
  }

  snapshot(): ConversationState {
    return this.state;
  }
}
