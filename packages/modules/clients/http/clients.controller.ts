import type { ClientDetail, ClientSummary } from '@amc/contracts';
import { type Caller, CurrentCaller } from '@amc/http-kit';
import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
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
  constructor(@Inject(ReadClients) private readonly clients: ReadClients) {}

  @Get()
  async list(
    @CurrentCaller() caller: Caller,
    @Query('limit') limit?: string,
  ): Promise<{ clients: ClientSummary[] }> {
    return { clients: await this.clients.list(caller, limit ? Number(limit) : undefined) };
  }

  @Get(':id')
  async detail(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<ClientDetail> {
    const client = await this.clients.detail(caller, id);
    // Out of scope and non-existent answer identically. Anything else would
    // confirm that a particular company is on the firm's books.
    if (!client) throw new NotFoundException('No such client');
    return client;
  }
}
