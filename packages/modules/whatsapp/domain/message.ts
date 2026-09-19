import { Conflict, type Result, err, ok } from '@amc/kernel';

/** What arrived, or what is going out. */
export type MessageKind =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'template'
  | 'interactive'
  | 'unsupported';

export type Direction = 'inbound' | 'outbound';

/**
 * Where an outbound message has got to.
 *
 * `received` is the only state an inbound message is ever in, and no outbound
 * message is ever in it.
 */
export type DeliveryStatus = 'received' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * How far along each state is.
 *
 * Meta's status webhooks arrive out of order — `delivered` before `sent` is
 * routine, and a `sent` callback after a `read` one is not unusual either. A
 * naive handler that writes whatever arrived last shows a message as sent when
 * the client has already read it, and worse, shows a delivered message as
 * merely sent and invites somebody to send it again.
 *
 * So statuses only ever move forwards. `failed` is the exception: it is
 * terminal from wherever it happens, because a message that failed after being
 * accepted really did fail.
 */
const PROGRESS: Readonly<Record<DeliveryStatus, number>> = {
  received: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

/** The kinds this system can actually read the contents of. */
const READABLE: readonly MessageKind[] = ['text', 'interactive'];

/** The kinds that carry a file worth keeping. */
const CARRIES_FILE: readonly MessageKind[] = ['image', 'document'];

export function isReadable(kind: MessageKind): boolean {
  return READABLE.includes(kind);
}

export function carriesFile(kind: MessageKind): boolean {
  return CARRIES_FILE.includes(kind);
}

export interface MessageState {
  readonly id: string;
  readonly conversationId: string;
  readonly direction: Direction;
  /** Meta's id. Null on an outbound message until Meta has accepted it. */
  readonly providerMessageId: string | null;
  readonly kind: MessageKind;
  readonly body: string | null;
  readonly templateName: string | null;
  readonly mediaId: string | null;
  readonly mediaMimeType: string | null;
  readonly mediaFilename: string | null;
  /** The client document this attachment became, once it was filed. */
  readonly documentId: string | null;
  readonly status: DeliveryStatus;
  readonly failureReason: string | null;
  /** Null on an outbound message means the bot sent it. */
  readonly sentByUserId: string | null;
  readonly contactLogEntryId: string | null;
  readonly occurredAt: Date;
}

/**
 * One WhatsApp message.
 *
 * Thin on purpose. The rules worth having here are the two that cost something
 * when they are wrong — a status that must not move backwards, and a message
 * that must carry something — and everything else about a message is decided by
 * the conversation it is in.
 */
export class Message {
  private constructor(private state: MessageState) {}

  static rehydrate(state: MessageState): Message {
    return new Message(state);
  }

  /** Something the client sent. */
  static received(params: {
    id: string;
    conversationId: string;
    providerMessageId: string;
    kind: MessageKind;
    body?: string | null;
    mediaId?: string | null;
    mediaMimeType?: string | null;
    mediaFilename?: string | null;
    occurredAt: Date;
  }): Result<Message, Conflict> {
    const body = params.body?.trim() ?? null;
    if (!body && !params.mediaId) {
      /*
       * A row with neither words nor a file records that a message existed and
       * nothing about it, which is worse than not recording it: it appears in
       * the thread as an empty bubble and nobody can tell whether something was
       * lost or nothing was said.
       *
       * The kinds this happens for — a location pin, a contact card — are still
       * handled, by the caller storing a short description as the body.
       */
      return err(new Conflict('A message has to carry words or a file'));
    }

    return ok(
      new Message({
        id: params.id,
        conversationId: params.conversationId,
        direction: 'inbound',
        providerMessageId: params.providerMessageId,
        kind: params.kind,
        body: body ?? null,
        templateName: null,
        mediaId: params.mediaId ?? null,
        mediaMimeType: params.mediaMimeType ?? null,
        mediaFilename: params.mediaFilename ?? null,
        documentId: null,
        status: 'received',
        failureReason: null,
        sentByUserId: null,
        contactLogEntryId: null,
        occurredAt: params.occurredAt,
      }),
    );
  }

  /**
   * Something we are about to send, written down before it goes out.
   *
   * Written first so that a message Meta never accepted is visible as a failure
   * rather than absent. The whole point of the channel is being able to show
   * the client was asked, and a send that vanished proves the opposite.
   */
  static queued(params: {
    id: string;
    conversationId: string;
    body?: string | null;
    templateName?: string | null;
    sentByUserId?: string | null;
    occurredAt: Date;
  }): Result<Message, Conflict> {
    const body = params.body?.trim() ?? null;
    if (!body && !params.templateName) {
      return err(new Conflict('Say what to send'));
    }

    return ok(
      new Message({
        id: params.id,
        conversationId: params.conversationId,
        direction: 'outbound',
        providerMessageId: null,
        kind: params.templateName ? 'template' : 'text',
        body,
        templateName: params.templateName ?? null,
        mediaId: null,
        mediaMimeType: null,
        mediaFilename: null,
        documentId: null,
        status: 'queued',
        failureReason: null,
        sentByUserId: params.sentByUserId ?? null,
        contactLogEntryId: null,
        occurredAt: params.occurredAt,
      }),
    );
  }

  get id(): string {
    return this.state.id;
  }

  get kind(): MessageKind {
    return this.state.kind;
  }

  get status(): DeliveryStatus {
    return this.state.status;
  }

  get sentByBot(): boolean {
    return this.state.direction === 'outbound' && this.state.sentByUserId === null;
  }

  /** Meta accepted it and gave it an id. */
  accepted(providerMessageId: string): void {
    this.state = {
      ...this.state,
      providerMessageId,
      status: this.forwardsOnly('sent'),
    };
  }

  /**
   * A status callback arrived.
   *
   * Out-of-order callbacks are ignored rather than rejected: there is nothing
   * wrong with them, they are simply stale, and an error would put a job back
   * on the queue to be retried forever.
   */
  advanceTo(status: DeliveryStatus, detail?: string | null): void {
    if (status === 'failed') {
      this.state = {
        ...this.state,
        status: 'failed',
        failureReason: detail ?? 'WhatsApp rejected the message without saying why',
      };
      return;
    }
    this.state = { ...this.state, status: this.forwardsOnly(status) };
  }

  private forwardsOnly(status: DeliveryStatus): DeliveryStatus {
    return PROGRESS[status] > PROGRESS[this.state.status] ? status : this.state.status;
  }

  /** The attachment was filed as a client document. */
  filedAs(documentId: string): void {
    this.state = { ...this.state, documentId };
  }

  /** The contact log entry this message produced. */
  loggedAs(entryId: string): void {
    this.state = { ...this.state, contactLogEntryId: entryId };
  }

  snapshot(): MessageState {
    return this.state;
  }
}
