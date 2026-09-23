import type { ClientQuotationView } from '@amc/contracts';
import { answerQuotationSchema } from '@amc/contracts';
import { Public } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ClientQuotation } from '../application/client-quotation.js';

/**
 * The quotation a client opens from the link they were sent (FR-30).
 *
 * Public, because a client has no account and the whole point is that they do
 * not need one. What stands in for a session is the token in the URL: 32
 * random bytes, stored only as a hash, with an expiry.
 *
 * Every failure is 404 with the same words. A wrong token, an expired link, a
 * quotation already answered and one never sent all read alike — anything
 * else tells somebody working through guesses which of them they have found.
 * The token is in the path rather than a query string so it stays out of
 * referrer headers and server logs that record query strings.
 */
@Controller('public/quotations')
export class ClientQuotationController {
  constructor(@Inject(ClientQuotation) private readonly quotations: ClientQuotation) {}

  @Public()
  @Get(':token')
  async open(@Param('token') token: string): Promise<ClientQuotationView> {
    const opened = await this.quotations.open(token);
    if (!opened.ok) throw new NotFoundException(opened.error.message);
    return opened.value;
  }

  @Public()
  @Post(':token/answer')
  async answer(@Param('token') token: string, @Body() body: unknown): Promise<ClientQuotationView> {
    const parsed = answerQuotationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say yes or no');

    const answered = await this.quotations.answer(token, parsed.data.decision);
    // Including "already answered": a client who presses accept twice should
    // see the accepted page, and somebody guessing should learn nothing.
    if (!answered.ok) throw new NotFoundException(answered.error.message);
    return answered.value;
  }
}
