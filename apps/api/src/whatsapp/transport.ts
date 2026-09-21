import { Conflict, type Result, err, ok } from '@amc/kernel';
import type { WhatsAppTransport } from '@amc/whatsapp';
import type { Language } from '@amc/whatsapp/domain';
import type { Logger } from 'pino';

/**
 * Talking to WhatsApp without a WhatsApp account.
 *
 * The same arrangement email had before SES: the whole path runs — the message
 * is composed, stored, queued, given an id and marked sent — and the last step
 * writes to the log instead of to somebody's phone. What is left untested when
 * the real credentials arrive is one HTTP call, not the bot.
 *
 * The invented ids look like Meta's and are never repeated, because code
 * downstream stores them in a unique index and a fake that returned the same
 * string twice would hide a duplicate-handling bug rather than exercise it.
 */
export function loggingTransport(logger: Logger): WhatsAppTransport {
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `wamid.LOCAL${Date.now().toString(36)}${counter}`;
  };

  return {
    async sendText({ to, body }) {
      logger.info({ to, body }, 'whatsapp (log driver): text');
      return ok({ providerMessageId: nextId() });
    },
    async sendTemplate({ to, name, language, variables }) {
      logger.info({ to, name, language, variables }, 'whatsapp (log driver): template');
      return ok({ providerMessageId: nextId() });
    },
    async fetchMedia(mediaId) {
      /*
       * There is nothing to fetch: the log driver never received a real
       * message, so no media id it is given can exist.
       *
       * A refusal rather than an invented file, because a use case that files
       * an invented document against a client is worse than one that reports
       * it could not fetch it.
       */
      logger.warn({ mediaId }, 'whatsapp (log driver): asked for media that cannot exist');
      return err(new Conflict('The log driver holds no media'));
    },
  };
}

export interface CloudApiSettings {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly apiVersion: string;
}

/**
 * Meta's Cloud API (PW-07).
 *
 * Deliberately `fetch` and not Meta's SDK: three endpoints are used, the SDK
 * carries its own auth and retry opinions, and a dependency that has to be
 * upgraded in step with a vendor is a dependency in the critical path of
 * somebody's tax deadline.
 *
 * Every failure comes back as a Conflict carrying whatever Meta said, because
 * the message that matters — "this number is not on WhatsApp", "the template
 * is not approved", "you are outside the 24 hour window" — is Meta's, and
 * replacing it with one of ours throws away the only useful part.
 */
export function cloudApiTransport(settings: CloudApiSettings, logger: Logger): WhatsAppTransport {
  const base = `https://graph.facebook.com/${settings.apiVersion}`;
  const headers = {
    authorization: `Bearer ${settings.accessToken}`,
    'content-type': 'application/json',
  };

  async function post(payload: unknown): Promise<Result<{ providerMessageId: string }, Conflict>> {
    let response: Response;
    try {
      response = await fetch(`${base}/${settings.phoneNumberId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        // Without this a stalled connection holds the request until Node gives
        // up on its own, which it does after rather a long time.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      logger.error({ err: error }, 'whatsapp: could not reach the Cloud API');
      return err(new Conflict('Could not reach WhatsApp'));
    }

    const answer = (await response.json().catch(() => null)) as CloudApiAnswer | null;
    if (!response.ok) {
      const said = answer?.error?.message ?? `WhatsApp refused it (${response.status})`;
      logger.warn({ status: response.status, said }, 'whatsapp: refused');
      return err(new Conflict(said));
    }

    const id = answer?.messages?.[0]?.id;
    if (!id) {
      // A 200 with no message id. Treated as a failure rather than a success
      // with a missing one, because an outbound row with no provider id can
      // never be matched to its delivery receipt.
      return err(new Conflict('WhatsApp accepted the message without naming it'));
    }
    return ok({ providerMessageId: id });
  }

  return {
    async sendText({ to, body }) {
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        // Link previews off: a chase that renders somebody's advert underneath
        // it is not the impression the practice is going for.
        text: { preview_url: false, body },
      });
    },

    async sendTemplate({ to, name, language, variables }) {
      return post({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          // Meta's codes, not ours. 'ar' and 'en' happen to match, and the
          // pair is written out so that a third language added later cannot
          // silently send the wrong one.
          language: { code: language === 'ar' ? 'ar' : 'en' },
          components:
            variables.length === 0
              ? []
              : [{ type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) }],
        },
      });
    },

    /**
     * Fetching an attachment, which is two requests.
     *
     * Meta gives a handle, the handle resolves to a short-lived URL, and that
     * URL needs the same bearer token as the API — a detail easy to miss
     * because the URL is on a different host and looks public.
     */
    async fetchMedia(mediaId) {
      try {
        const lookup = await fetch(`${base}/${mediaId}`, {
          headers: { authorization: headers.authorization },
          signal: AbortSignal.timeout(15_000),
        });
        if (!lookup.ok) return err(new Conflict('WhatsApp would not say where that file is'));

        const described = (await lookup.json()) as MediaDescription;
        if (!described.url) return err(new Conflict('WhatsApp gave no link for that file'));

        const download = await fetch(described.url, {
          headers: { authorization: headers.authorization },
          signal: AbortSignal.timeout(60_000),
        });
        if (!download.ok) return err(new Conflict('Could not download that file from WhatsApp'));

        return ok({
          body: Buffer.from(await download.arrayBuffer()),
          contentType: described.mime_type ?? 'application/octet-stream',
          filename: described.file_name ?? null,
        });
      } catch (error) {
        logger.error({ err: error, mediaId }, 'whatsapp: could not fetch media');
        return err(new Conflict('Could not download that file from WhatsApp'));
      }
    },
  };
}

type CloudApiAnswer = {
  messages?: { id?: string }[];
  error?: { message?: string };
};

type MediaDescription = {
  url?: string;
  mime_type?: string;
  file_name?: string;
};

export type { Language };
