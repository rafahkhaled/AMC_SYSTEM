import type { LeadBoard } from '@amc/contracts';
import { captureLeadSchema, convertLeadSchema, moveLeadSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { LeadWorkflow } from '../application/lead-workflow.js';
import { ReadLeads } from '../application/read-leads.js';

/**
 * The enquiry pipeline (FR-01).
 *
 * Not scoped, unlike everything else here. A lead is not yet anybody's
 * client, so there is no assignment to scope by, and hiding new enquiries
 * from the people who would answer them is how a lead goes cold. Reading is
 * open to anyone signed in; changing one needs `clients.edit`.
 */
@Controller('leads')
export class LeadsController {
  constructor(
    @Inject(ReadLeads) private readonly leads: ReadLeads,
    @Inject(LeadWorkflow) private readonly workflow: LeadWorkflow,
  ) {}

  @Get()
  async board(): Promise<LeadBoard> {
    return this.leads.board();
  }

  @Post()
  @RequirePermissions('clients.edit')
  async capture(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<LeadBoard> {
    const parsed = captureLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'That enquiry is incomplete',
      );
    }

    const outcome = await this.workflow.capture(caller, parsed.data);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.leads.board();
  }

  @Post(':id/move')
  @RequirePermissions('clients.edit')
  async move(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<LeadBoard> {
    const parsed = moveLeadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Move it to what?');

    const outcome = await this.workflow.move(caller, id, parsed.data.to, parsed.data.note);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    return this.leads.board();
  }

  /**
   * The enquiry gets a quotation (FR-01, FR-30).
   *
   * Creates the client the quotation will belong to and marks the enquiry
   * quoted, both in one transaction. The quotation itself is drafted by the
   * caller against the id this returns: it belongs to billing, and writing it
   * from here would put one module inside another's transaction.
   */
  @Post(':id/quote')
  @RequirePermissions('clients.edit')
  async quote(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ clientId: string; board: LeadBoard }> {
    const parsed = convertLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'The client needs a name');
    }

    const outcome = await this.workflow.quote(caller, id, parsed.data.legalName);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return { clientId: outcome.value.clientId, board: await this.leads.board() };
  }

  /** The enquiry becomes a client. Both writes commit together or neither does. */
  @Post(':id/convert')
  @RequirePermissions('clients.edit')
  async convert(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ clientId: string; board: LeadBoard }> {
    const parsed = convertLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'The client needs a name');
    }

    const outcome = await this.workflow.convert(caller, id, parsed.data.legalName);
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return { clientId: outcome.value.clientId, board: await this.leads.board() };
  }
}
