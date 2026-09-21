import type { WhatsAppConversationView, WhatsAppMessageView } from '@amc/contracts';
import type { Conflict, Result } from '@amc/kernel';
import type {
  Conversation,
  ConversationScope,
  DeadlineLine,
  DeliveryStatus,
  Language,
  Message,
  MessageKind,
} from '../domain/index.js';

/** One message, as the webhook adapter has already unpacked it. */
export interface InboundMessage {
  readonly providerMessageId: string;
  /** Already E.164 — the adapter used `fromWhatsAppAddress`. */
  readonly from: string;
  readonly profileName: string | null;
  readonly kind: MessageKind;
  readonly body: string | null;
  readonly mediaId: string | null;
  readonly mediaMimeType: string | null;
  readonly mediaFilename: string | null;
  readonly occurredAt: Date;
  /** What Meta sent, kept for the morning when something was handled wrongly. */
  readonly raw?: unknown;
}

/** A delivery status Meta reported about a message we sent. */
export interface StatusUpdate {
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
  readonly detail: string | null;
  readonly occurredAt: Date;
}

export interface ParsedWebhook {
  readonly messages: readonly InboundMessage[];
  readonly statuses: readonly StatusUpdate[];
  /** Entries this could not read at all, for the log. */
  readonly skipped: number;
}

/**
 * Meta's side of the webhook: the handshake, the signature, and the payload.
 *
 * A port because the route that uses it lives in this module's HTTP layer,
 * which may not reach into its own infrastructure — and should not, since a
 * controller that knows the payload shape has to change when Meta changes it.
 */
export interface WebhookGateway {
  /** The subscription handshake. Returns the challenge to echo, or nothing. */
  challengeFor(query: {
    mode: string | undefined;
    token: string | undefined;
    challenge: string | undefined;
  }): string | null;
  /**
   * Whether this delivery really came from Meta.
   *
   * Takes the raw bytes, not the parsed body: the signature is an HMAC over
   * exactly what was sent, and a re-serialised body digests differently even
   * when it holds the same data.
   */
  isAuthentic(rawBody: Buffer | string, header: string | undefined): boolean;
  read(payload: unknown): ParsedWebhook;
}

export interface ConversationRepository {
  findByPhone(phone: string): Promise<Conversation | null>;
  /**
   * Unscoped, for the webhook.
   *
   * A message from a client arrives with nobody signed in, so there is no
   * caller to scope by. Nothing that acts on behalf of a person may use this.
   */
  findById(id: string): Promise<Conversation | null>;
  /** Scoped, for everything a person does. Out of scope reads as not there. */
  findVisible(id: string, scope: ConversationScope): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
}

export interface MessageRepository {
  /**
   * Stores it, or reports that this message has already been stored.
   *
   * Meta retries a webhook delivery it believes failed, and it retries often.
   * The unique constraint on the provider's id in the database is what makes
   * that safe; this returns which happened so the caller can decline to answer
   * a message twice.
   */
  store(message: Message): Promise<'stored' | 'already_had_it'>;
  save(message: Message): Promise<void>;
  findByProviderId(providerMessageId: string): Promise<Message | null>;
  thread(conversationId: string, limit: number): Promise<Message[]>;
}

/**
 * The conversations screen, and one thread.
 *
 * A reader rather than a repository: these are joins across four tables that
 * produce views, and rehydrating aggregates in order to throw most of them away
 * would be slower and say less.
 */
export interface ConversationReader {
  list(scope: ConversationScope, now: Date): Promise<WhatsAppConversationView[]>;
  thread(
    id: string,
    scope: ConversationScope,
    now: Date,
  ): Promise<{
    conversation: WhatsAppConversationView;
    messages: WhatsAppMessageView[];
  } | null>;
}

/**
 * Whose number this is.
 *
 * Implemented against `client_contacts.phone_e164` and `leads.phone_e164`. It
 * returns nothing rather than a best guess: an unmatched conversation is
 * handled properly, and a wrong match files a trade licence against the wrong
 * company.
 */
export interface ContactDirectory {
  whoseNumber(phone: string): Promise<{
    clientId: string;
    contactId: string | null;
    contactName: string | null;
    /** The language on the client's record, when there is one. */
    language: Language | null;
  } | null>;
}

/**
 * Writing to the contact log, which stays the single place to ask what was said
 * to a client.
 *
 * Deliberately narrow, and deliberately without a caller: a webhook has nobody
 * signed in, and the alternative — inventing a caller inside this module — is
 * how a module ends up deciding its own access rules. The adapter in the
 * composition root supplies the system actor.
 */
export interface ContactLogWriter {
  record(entry: {
    clientId: string;
    direction: 'inbound' | 'outbound';
    happenedAt: Date;
    summary: string;
    contactId?: string | null;
  }): Promise<string | null>;
}

/** Filing an attachment as a client document, awaiting somebody's review. */
export interface DocumentFiler {
  file(params: {
    clientId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Result<{ documentId: string }, Conflict>>;
}

/** What this client owes and when, from the deadline engine. */
export interface DeadlineReader {
  upcomingFor(clientId: string, withinDays: number): Promise<DeadlineLine[]>;
}

/**
 * Who should pick this conversation up.
 *
 * The client's own accountant when they have one, because being handed to a
 * stranger is most of what makes people dislike a chatbot. Null when nobody is
 * assigned, which is itself worth knowing — it means a client is writing in and
 * the practice has nobody looking after them.
 */
export interface StaffPicker {
  forClient(clientId: string | null): Promise<{ userId: string } | null>;
  /** Whoever answers the unmatched ones. */
  onDuty(): Promise<{ userId: string } | null>;
}

/** Telling somebody at the practice that a conversation is waiting for them. */
export interface StaffNotifier {
  conversationNeedsYou(params: {
    userId: string;
    conversationId: string;
    clientId: string | null;
    phone: string;
    said: string;
  }): Promise<void>;
}

/**
 * Talking to WhatsApp.
 *
 * The production adapter is Meta's Cloud API. Development uses one that writes
 * to the log and invents an id, which is how the whole path is exercised
 * without a business account — the same arrangement email had before SES.
 */
export interface WhatsAppTransport {
  sendText(params: {
    to: string;
    body: string;
  }): Promise<Result<{ providerMessageId: string }, Conflict>>;

  sendTemplate(params: {
    to: string;
    name: string;
    language: Language;
    variables: readonly string[];
  }): Promise<Result<{ providerMessageId: string }, Conflict>>;

  /** Fetches an attachment Meta is holding for us. */
  fetchMedia(
    mediaId: string,
  ): Promise<Result<{ body: Buffer; contentType: string; filename: string | null }, Conflict>>;
}

/** The practice's own name, as it appears in a greeting. */
export interface PracticeIdentity {
  readonly name: { readonly en: string; readonly ar: string };
}

/** The caller. Re-exported so modules import their ports, not the kernel. */
export type { CallerLike } from '@amc/kernel';
