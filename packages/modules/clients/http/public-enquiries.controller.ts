import { publicEnquirySchema } from '@amc/contracts';
import { Public } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Options,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { LeadWorkflow } from '../application/lead-workflow.js';
import { EnquiryThrottle } from './enquiry-throttle.js';

/** The websites allowed to post an enquiry, from configuration. */
export const PUBLIC_SITE_ORIGINS = Symbol('PUBLIC_SITE_ORIGINS');

interface RequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string | undefined;
}
interface ResponseLike {
  setHeader(name: string, value: string): unknown;
}

/**
 * The firm's website sending an enquiry into the CRM.
 *
 * Public on purpose, and the only route here that is. It does one thing: turns
 * a form into a lead. Cross-origin because the website is a different address
 * from the application, so the answer names the website that asked and nobody
 * else; a request from anywhere else is refused before anything is written.
 * No cookie is read or set, so none of this can be used to act as a signed-in
 * person.
 */
@Public()
@Controller('public/enquiries')
export class PublicEnquiriesController {
  constructor(
    @Inject(LeadWorkflow) private readonly workflow: LeadWorkflow,
    @Inject(EnquiryThrottle) private readonly throttle: EnquiryThrottle,
    @Inject(PUBLIC_SITE_ORIGINS) private readonly origins: readonly string[],
  ) {}

  /** The browser's permission check before it sends the real request. */
  @Options()
  @HttpCode(204)
  preflight(@Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike): void {
    const origin = this.allowedOrigin(request);
    if (!origin) throw new ForbiddenException('That website may not send enquiries here');
    this.cors(response, origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '86400');
  }

  @Post()
  @HttpCode(201)
  async receive(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const origin = this.allowedOrigin(request);
    if (!origin) throw new ForbiddenException('That website may not send enquiries here');
    this.cors(response, origin);

    const parsed = publicEnquirySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Please check the form');
    }

    // A filled honeypot is a bot. It is told it worked, so it learns nothing
    // and has no reason to try a different way in.
    if (parsed.data.website) return { received: true };

    const address = request.ip ?? 'unknown';
    if (!this.throttle.allow(address)) {
      throw new HttpException(
        'Too many requests. Please try again later, or message us on WhatsApp.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { website: _honeypot, ...enquiry } = parsed.data;
    const outcome = await this.workflow.captureFromWebsite({
      ...enquiry,
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return { received: true };
  }

  private allowedOrigin(request: RequestLike): string | null {
    const origin = request.headers.origin;
    return typeof origin === 'string' && this.origins.includes(origin) ? origin : null;
  }

  private cors(response: ResponseLike, origin: string): void {
    response.setHeader('Access-Control-Allow-Origin', origin);
    // The answer depends on who asked, so a cache must not hand one site's
    // answer to another.
    response.setHeader('Vary', 'Origin');
  }
}
