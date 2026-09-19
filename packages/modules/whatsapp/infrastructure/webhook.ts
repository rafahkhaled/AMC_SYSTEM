import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromWhatsAppAddress } from '@amc/kernel';
import type { InboundMessage } from '../application/receive-message.js';
import type { DeliveryStatus, MessageKind } from '../domain/index.js';

/**
 * Reading what Meta sent.
 *
 * Kept as pure functions over a payload, separate from anything that talks to
 * the network, because this is where the mistakes are. The shape is nested four
 * deep, every level is an array that usually has one element, the fields that
 * matter are optional, and the parts that look interchangeable are not: a text
 * message's words are at `text.body` and a button reply's are at
 * `interactive.button_reply.title`, and reading the wrong one gives you
 * `undefined` rather than an error.
 *
 * So the payload is typed as unknown and picked apart deliberately. Anything
 * unrecognised is skipped rather than guessed at, and the raw entry is kept so
 * that a message handled wrongly can be looked at afterwards.
 */

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
 * Checks the signature Meta puts on every delivery.
 *
 * Without this the endpoint is open: anybody who learns the URL can post a
 * message that appears to come from any client's number, and the practice would
 * file whatever they sent and answer it in its own name. The signature is an
 * HMAC over the exact bytes of the body, so the raw buffer has to survive JSON
 * parsing — a re-serialised body produces a different digest even when it is the
 * same data.
 */
export function signatureMatches(params: {
  rawBody: Buffer | string;
  header: string | undefined;
  appSecret: string;
}): boolean {
  if (!params.header || !params.appSecret) return false;

  const prefix = 'sha256=';
  if (!params.header.startsWith(prefix)) return false;

  const offered = Buffer.from(params.header.slice(prefix.length), 'hex');
  const expected = createHmac('sha256', params.appSecret).update(params.rawBody).digest();

  // Lengths must match before comparing, because timingSafeEqual throws on a
  // mismatch — and a throw is a shorter code path than a comparison, which is
  // the timing leak this function exists to avoid.
  if (offered.length !== expected.length) return false;
  return timingSafeEqual(offered, expected);
}

/**
 * Meta's subscription handshake.
 *
 * It calls the endpoint with a token it was given when the webhook was
 * configured and expects the challenge echoed back verbatim. Answering it
 * wrongly is not an error anybody sees: the webhook simply never starts
 * delivering.
 */
export function verificationChallenge(params: {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
  verifyToken: string;
}): string | null {
  if (params.mode !== 'subscribe') return null;
  if (!params.token || !params.verifyToken) return null;
  if (params.token !== params.verifyToken) return null;
  return params.challenge ?? null;
}

/** Meta's kinds, as they appear on the `type` field. */
const KINDS: Readonly<Record<string, MessageKind>> = {
  text: 'text',
  image: 'image',
  document: 'document',
  audio: 'audio',
  voice: 'audio',
  video: 'video',
  sticker: 'sticker',
  location: 'location',
  contacts: 'contacts',
  interactive: 'interactive',
  button: 'interactive',
};

/** Meta's statuses, as they appear on a status callback. */
const STATUSES: Readonly<Record<string, DeliveryStatus>> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

export function parseWebhook(payload: unknown): ParsedWebhook {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  let skipped = 0;

  for (const change of changesIn(payload)) {
    const value = record(change.value);
    if (!value) {
      skipped += 1;
      continue;
    }

    // The sender's display name lives beside the messages rather than on them,
    // keyed by the same wa_id.
    const names = new Map<string, string>();
    for (const contact of array(value.contacts)) {
      const entry = record(contact);
      const waId = string(entry?.wa_id);
      const name = string(record(entry?.profile)?.name);
      if (waId && name) names.set(waId, name);
    }

    for (const raw of array(value.messages)) {
      const message = readMessage(raw, names);
      if (message) messages.push(message);
      else skipped += 1;
    }

    for (const raw of array(value.statuses)) {
      const status = readStatus(raw);
      if (status) statuses.push(status);
      else skipped += 1;
    }
  }

  return { messages, statuses, skipped };
}

function readMessage(raw: unknown, names: Map<string, string>): InboundMessage | null {
  const entry = record(raw);
  if (!entry) return null;

  const providerMessageId = string(entry.id);
  const waId = string(entry.from);
  if (!providerMessageId || !waId) return null;

  /*
   * The number as E.164, using the WhatsApp-specific reading of it.
   *
   * Not `toE164`: Meta always sends the plus stripped, and reading '966...'
   * as something a person typed makes it a malformed local number that reduces
   * to nothing. A null here is still passed on, as the raw digits, so the use
   * case can refuse it rather than this silently dropping the message.
   */
  const from = fromWhatsAppAddress(waId) ?? waId;

  const type = string(entry.type) ?? 'unsupported';
  const kind = KINDS[type] ?? 'unsupported';

  const media = record(entry[type]);
  const body =
    string(record(entry.text)?.body) ??
    string(record(record(entry.interactive)?.button_reply)?.title) ??
    string(record(record(entry.interactive)?.list_reply)?.title) ??
    string(record(entry.button)?.text) ??
    // An image or a document may arrive with a caption, which is often where
    // the client says what the file actually is.
    string(media?.caption) ??
    null;

  return {
    providerMessageId,
    from,
    profileName: names.get(waId) ?? null,
    kind,
    body,
    mediaId: string(media?.id) ?? null,
    mediaMimeType: string(media?.mime_type) ?? null,
    mediaFilename: string(media?.filename) ?? null,
    occurredAt: secondsToDate(entry.timestamp),
    raw,
  };
}

function readStatus(raw: unknown): StatusUpdate | null {
  const entry = record(raw);
  if (!entry) return null;

  const providerMessageId = string(entry.id);
  const status = STATUSES[string(entry.status) ?? ''];
  if (!providerMessageId || !status) return null;

  // Meta reports the reason for a failure in an array of errors, each with a
  // title and a longer description. The title is the useful half.
  const [firstError] = array(entry.errors);
  const error = record(firstError);
  const detail =
    string(error?.title) ?? string(error?.message) ?? string(record(error?.error_data)?.details);

  return {
    providerMessageId,
    status,
    detail: detail ?? null,
    occurredAt: secondsToDate(entry.timestamp),
  };
}

/** Walks `entry[].changes[]`, which is the only useful path into the payload. */
function changesIn(payload: unknown): { value: unknown }[] {
  const body = record(payload);
  const found: { value: unknown }[] = [];

  for (const entry of array(body?.entry)) {
    for (const change of array(record(entry)?.changes)) {
      const asRecord = record(change);
      // `field` is 'messages' for everything this cares about. Other
      // subscriptions — account quality updates, template approvals — arrive on
      // the same endpoint and are not messages.
      if (string(asRecord?.field) !== 'messages') continue;
      found.push({ value: asRecord?.value });
    }
  }

  return found;
}

/**
 * Meta's timestamps are seconds, as a string.
 *
 * Passing them to `new Date` unchanged gives 1970, and a message dated 1970
 * sorts to the top of every thread and sits above the twenty-four hour window
 * as permanently expired.
 */
function secondsToDate(value: unknown): Date {
  const seconds =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
