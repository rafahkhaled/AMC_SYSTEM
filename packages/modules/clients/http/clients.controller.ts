import {
  type ClientDetail,
  type ClientSummary,
  changeClientDetailsSchema,
  onboardClientSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { NotFound } from '@amc/kernel';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ManageClientDetails } from '../application/manage-client-details.js';
import { ReadClients } from '../application/read-clients.js';

/**
 * The client file.
 *
 * Deliberately not guarded by a permission decorator. The two view
 * permissions are alternatives, not a set: a manager holds
 * clients.view.all and an accountant holds clients.view.assigned, so
 * requiring either one by name would lock out the other role.
 *
 * The scope does the work instead, and does it better. Someone with neither
 * permission gets an empty list and a not-found, which is the same answer an
 * accountant gets for a client that is not theirs. Nothing is leaked by
 * letting the request through, and there is one rule rather than two that can
 * disagree.
 */
@Controller('clients')
export class ClientsController {
  constructor(
    @Inject(ReadClients) private readonly clients: ReadClients,
    @Inject(ManageClientDetails) private readonly details: ManageClientDetails,
  ) {}

  @Get()
  async list(
    @CurrentCaller() caller: Caller,
    @Query('limit') limit?: string,
  ): Promise<{ clients: ClientSummary[] }> {
    return { clients: await this.clients.list(caller, limit ? Number(limit) : undefined) };
  }

  /** A client added directly, not converted from an enquiry. */
  @RequirePermissions('clients.edit')
  @Post()
  async onboard(@CurrentCaller() caller: Caller, @Body() body: unknown): Promise<ClientDetail> {
    const parsed = onboardClientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'A client needs a legal name',
      );
    }
    const created = await this.details.onboard(caller, parsed.data);
    if (!created.ok) throw new ConflictException(created.error.message);
    return this.detail(caller, created.value.clientId);
  }

  @Get(':id')
  async detail(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<ClientDetail> {
    const client = await this.clients.detail(caller, id);
    // Out of scope and non-existent answer identically. Anything else would
    // confirm that a particular company is on the firm's books.
    if (!client) throw new NotFoundException('No such client');
    return client;
  }

  /** Contact, licence, tax numbers, weekly day off and reference numbers. */
  @RequirePermissions('clients.edit')
  @Patch(':id/details')
  async change(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClientDetail> {
    const parsed = changeClientDetailsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Check the details');
    }
    const outcome = await this.details.change(caller, id, parsed.data);
    if (!outcome.ok) {
      if (outcome.error instanceof NotFound) throw new NotFoundException(outcome.error.message);
      throw new ConflictException(outcome.error.message);
    }
    return this.detail(caller, id);
  }
}
