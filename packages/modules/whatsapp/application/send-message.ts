import { type Clock, Conflict, type IdGenerator, type Result, err, ok } from '@amc/kernel';
import { type Language, Message } from '../domain/index.js';
import type {
  CallerLike,
  ContactLogWriter,
  ConversationRepository,
  MessageRepository,
  WhatsAppTransport,
} from './ports.js';

export interface SendAsPersonCommand {
  readonly conversationId: string;
  readonly body: string;
}

export interface SendTemplateCommand {
  readonly conversationId: string;
  readonly name: string;
  readonly variables: readonly string[];
  readonly language?: Language | undefined;
}

/**
 * Sending a message out (PW-07).
 *
 * Two doors, because there are two genuinely different acts. A person typing to
 * a client is bound by Meta's window and by nothing else. An automatic chase is
 * bound by the window *and* by whether the client asked to be left alone, and it
 * goes out as an approved template because that is the only thing Meta will
 * accept outside the window.
 *
 * Both write the message down before sending it. A send that vanished proves the
 * opposite of what this channel exists to prove.
 */
export class SendMessage {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly log: ContactLogWriter,
    private readonly transport: WhatsAppTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * A member of staff writes to the client.
   *
   * Taking over the conversation is part of sending, not a separate step
   * somebody has to remember: having typed to the client, they own the
   * conversation, and leaving the bot to answer the reply would undo what they
   * just did.
   */
  async asPerson(
    caller: CallerLike,
    command: SendAsPersonCommand,
  ): Promise<Result<{ messageId: string }, Conflict>> {
    const conversation = await this.conversations.findById(command.conversationId);
    if (!conversation) return err(new Conflict('There is no such conversation'));

    const now = this.clock.now();
    const body = command.body.trim();
    if (body.length === 0) return err(new Conflict('Say something'));

    /*
     * An opted-out client can still be written to by a person.
     *
     * STOP means "no more automatic messages", not "my accountant may never
     * contact me again" — and somebody who types STOP at a reminder and then
     * has a real question would be badly served by the second reading. So this
     * checks the window, which is Meta's rule and cannot be waived, and not the
     * opt-out, which is ours.
     */
    const window = conversation.windowAt(now);
    if (window === 'closed') {
      return err(
        new Conflict(
          'This client has not written in the last 24 hours, so WhatsApp will only accept an approved template',
        ),
      );
    }

    const queued = Message.queued({
      id: this.ids.next(),
      conversationId: conversation.id,
      body,
      sentByUserId: caller.userId,
      occurredAt: now,
    });
    if (!queued.ok) return err(queued.error);
    await this.messages.store(queued.value);

    const sent = await this.transport.sendText({ to: conversation.phone, body });
    if (!sent.ok) {
      queued.value.advanceTo('failed', sent.error.message);
      await this.messages.save(queued.value);
      return err(sent.error);
    }

    queued.value.accepted(sent.value.providerMessageId);
    conversation.recordOutbound(now);
    // Typing to the client is taking the conversation, whether or not anybody
    // pressed a button that says so.
    conversation.takeOver({ userId: caller.userId, reason: 'staff_chose', now });

    await this.messages.save(queued.value);
    await this.conversations.save(conversation);
    await this.logIt(conversation.clientId, conversation.contactId, now, `WhatsApp: ${body}`);

    return ok({ messageId: queued.value.id });
  }

  /**
   * An approved template goes out — a chase, a reminder, a deadline notice.
   *
   * This is the only thing that reaches a client outside the window, and the
   * only thing an opt-out stops. It does not take the conversation over: a
   * template is the practice's automatic voice, and leaving the bot able to
   * answer the reply is the point of sending it.
   */
  async asTemplate(command: SendTemplateCommand): Promise<Result<{ messageId: string }, Conflict>> {
    const conversation = await this.conversations.findById(command.conversationId);
    if (!conversation) return err(new Conflict('There is no such conversation'));

    const now = this.clock.now();
    const allowed = conversation.maySend({ kind: 'template', name: command.name }, now);
    if (!allowed.ok) return err(allowed.error);

    const language = command.language ?? conversation.language;
    const queued = Message.queued({
      id: this.ids.next(),
      conversationId: conversation.id,
      templateName: command.name,
      body: command.variables.join(' · ') || null,
      occurredAt: now,
    });
    if (!queued.ok) return err(queued.error);
    await this.messages.store(queued.value);

    const sent = await this.transport.sendTemplate({
      to: conversation.phone,
      name: command.name,
      language,
      variables: command.variables,
    });
    if (!sent.ok) {
      queued.value.advanceTo('failed', sent.error.message);
      await this.messages.save(queued.value);
      return err(sent.error);
    }

    queued.value.accepted(sent.value.providerMessageId);
    conversation.recordOutbound(now);
    await this.messages.save(queued.value);
    await this.conversations.save(conversation);
    await this.logIt(
      conversation.clientId,
      conversation.contactId,
      now,
      `WhatsApp (automatic): ${command.name}`,
    );

    return ok({ messageId: queued.value.id });
  }

  /** A person takes the conversation without writing anything yet. */
  async takeOver(caller: CallerLike, conversationId: string): Promise<Result<void, Conflict>> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) return err(new Conflict('There is no such conversation'));

    const taken = conversation.takeOver({
      userId: caller.userId,
      reason: 'staff_chose',
      now: this.clock.now(),
    });
    if (!taken.ok) return err(taken.error);

    await this.conversations.save(conversation);
    return ok(undefined);
  }

  /** And gives it back, once whatever it was is dealt with. */
  async handBack(conversationId: string): Promise<Result<void, Conflict>> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) return err(new Conflict('There is no such conversation'));

    const handed = conversation.handBack(this.clock.now());
    if (!handed.ok) return err(handed.error);

    await this.conversations.save(conversation);
    return ok(undefined);
  }

  /**
   * Somebody says whose number this is.
   *
   * This is what the unmatched queue is for, and it is why that queue is a
   * screen rather than an archive: a file sent from an unrecognised number can
   * still be fetched afterwards, but only while Meta is still holding it.
   */
  async identify(
    conversationId: string,
    clientId: string,
    contactId?: string,
  ): Promise<Result<void, Conflict>> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) return err(new Conflict('There is no such conversation'));

    const identified = conversation.identify({
      clientId,
      ...(contactId === undefined ? {} : { contactId }),
      now: this.clock.now(),
    });
    if (!identified.ok) return err(identified.error);

    await this.conversations.save(conversation);
    return ok(undefined);
  }

  private async logIt(
    clientId: string | null,
    contactId: string | null,
    at: Date,
    summary: string,
  ): Promise<void> {
    if (!clientId) return;
    try {
      await this.log.record({
        clientId,
        direction: 'outbound',
        happenedAt: at,
        summary: summary.slice(0, 2000),
        contactId,
      });
    } catch {
      // The message is stored either way.
    }
  }
}
