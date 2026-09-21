import { Public } from '@amc/http-kit';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { WebhookGateway } from '../application/ports.js';
import { ReceiveMessage } from '../application/receive-message.js';
import { RecordDelivery } from '../application/record-delivery.js';

/** The gateway, supplied by the composition root. */
export const WEBHOOK_GATEWAY = Symbol('amc.whatsapp.webhookGateway');

/**
 * Where Meta delivers (PW-03).
 *
 * Public, because Meta has no session and never will. What stands in for one is
 * the signature on every delivery: without checking it, anybody who learns this
 * URL can post a message that appears to come from any client's number, and the
 * practice would file whatever they sent and answer it in its own name.
 *
 * It answers 200 to anything it accepted, including a payload it could not
 * understand. Meta retries a delivery that did not return 200 — for a day, with
 * increasing gaps, and enough failures disable the webhook altogether. So a
 * message this cannot read is logged and swallowed, and the only thing that
 * earns a refusal is a bad signature.
 */
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly log = new Logger(WhatsAppWebhookController.name);

  constructor(
    @Inject(WEBHOOK_GATEWAY) private readonly gateway: WebhookGateway,
    @Inject(ReceiveMessage) private readonly receive: ReceiveMessage,
    @Inject(RecordDelivery) private readonly deliveries: RecordDelivery,
  ) {}

  /**
   * The subscription handshake.
   *
   * Meta calls this once when the webhook is configured and expects the
   * challenge echoed back verbatim, as plain text. Answering wrongly is not an
   * error anybody sees: the webhook simply never starts delivering.
   */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const answer = this.gateway.challengeFor({ mode, token, challenge });
    // Not found rather than forbidden: an endpoint that says "wrong token" to
    // a guess is an endpoint that confirms the right one exists.
    if (answer === null) throw new NotFoundException();
    return answer;
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async deliver(@Req() request: RawBodyRequest): Promise<{ received: true }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      /*
       * The raw bytes did not survive the JSON parser.
       *
       * That is a wiring mistake in the composition root, not an attack, but it
       * cannot be waved through: without the bytes there is no signature to
       * check, and accepting the delivery anyway would leave the endpoint open
       * exactly as if the check had been removed on purpose.
       */
      this.log.error('The webhook body was parsed without keeping the raw bytes');
      throw new ForbiddenException();
    }

    if (!this.gateway.isAuthentic(rawBody, request.header('x-hub-signature-256'))) {
      throw new ForbiddenException();
    }

    const parsed = this.gateway.read(request.body);
    if (parsed.skipped > 0) {
      this.log.warn(`Skipped ${parsed.skipped} webhook entries this delivery could not read`);
    }

    for (const message of parsed.messages) {
      /*
       * One at a time, and a failure of one does not stop the rest.
       *
       * Meta batches several messages into one delivery, and a retry would
       * replay the whole batch. The ones that succeeded are safe to replay —
       * the provider id is unique and a second store is a no-op — but only if
       * this does not abandon the batch partway and return a non-200.
       */
      try {
        await this.receive.handle(message);
      } catch (error) {
        this.log.error(`Could not handle ${message.providerMessageId}`, error as Error);
      }
    }

    if (parsed.statuses.length > 0) {
      try {
        await this.deliveries.apply(parsed.statuses);
      } catch (error) {
        this.log.error('Could not record delivery statuses', error as Error);
      }
    }

    return { received: true };
  }
}

/**
 * Express's request, plus the raw bytes.
 *
 * Nest's own `RawBodyRequest` needs `rawBody: true` at bootstrap, which is set
 * in the API's main. Typed here so a controller reading `rawBody` off a plain
 * request does not silently get `undefined`.
 */
type RawBodyRequest = Request & { rawBody?: Buffer };
