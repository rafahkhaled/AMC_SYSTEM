import type { CredentialSummary, RevealedCredential } from '@amc/contracts';
import { revealCredentialSchema, storeCredentialSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ClientVault } from '../application/client-vault.js';

/**
 * A client's logins to the portals the practice files through (FR-05).
 *
 * Guarded on `clients.vault.read`, which only the manager and the accountant
 * hold, and then scoped again inside: holding the permission does not make
 * every client yours.
 *
 * Revealing is a POST rather than a GET. It changes something — it writes a
 * row to the audit log — and a GET invites caching, prefetching and a browser
 * history entry, none of which should happen to a password.
 */
@Controller('clients/:clientId/credentials')
export class VaultController {
  constructor(@Inject(ClientVault) private readonly vault: ClientVault) {}

  @Get()
  @RequirePermissions('clients.vault.read')
  async list(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
  ): Promise<{ credentials: CredentialSummary[] }> {
    // Usernames and notes only, so opening a client file does not write a
    // password read for every credential on it and drown the real one.
    return { credentials: await this.vault.list(caller, clientId) };
  }

  @Post()
  @RequirePermissions('clients.vault.read')
  async store(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ): Promise<{ credentials: CredentialSummary[] }> {
    const parsed = storeCredentialSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That login is incomplete');
    }

    const outcome = await this.vault.store(caller, { clientId, ...parsed.data });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return { credentials: await this.vault.list(caller, clientId) };
  }

  @Post(':credentialId/reveal')
  @RequirePermissions('clients.vault.read')
  async reveal(
    @CurrentCaller() caller: Caller,
    @Param('credentialId') credentialId: string,
    @Body() body: unknown,
  ): Promise<RevealedCredential> {
    const parsed = revealCredentialSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Say why');
    }

    const outcome = await this.vault.reveal(caller, credentialId, parsed.data.reason);
    // A credential out of scope and one that does not exist answer alike, so
    // an id cannot be used to learn which clients a firm has.
    if (!outcome.ok) throw new NotFoundException(outcome.error.message);

    return outcome.value;
  }

  @Delete(':credentialId')
  @RequirePermissions('clients.vault.read')
  async retire(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<{ credentials: CredentialSummary[] }> {
    const outcome = await this.vault.retire(caller, credentialId);
    if (!outcome.ok) throw new NotFoundException(outcome.error.message);
    return { credentials: await this.vault.list(caller, clientId) };
  }
}
