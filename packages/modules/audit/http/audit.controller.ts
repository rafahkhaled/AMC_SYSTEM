import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ReadAuditLog } from '../application/read-audit-log.js';
import type { AuditEntry } from '../domain/index.js';

/**
 * Reading the log is itself a privileged action, and one worth recording. The
 * permission is declared here and enforced by the guard identity registers
 * globally, so this module never learns how authentication works.
 */
@Controller('audit')
export class AuditController {
  constructor(@Inject(ReadAuditLog) private readonly readLog: ReadAuditLog) {}

  @Get()
  @RequirePermissions('audit.read')
  async search(
    @CurrentCaller() caller: Caller,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
    const parsedFrom = from ? new Date(from) : undefined;
    const parsedTo = to ? new Date(to) : undefined;
    if ((parsedFrom && Number.isNaN(+parsedFrom)) || (parsedTo && Number.isNaN(+parsedTo))) {
      throw new BadRequestException('Those dates cannot be read');
    }

    const outcome = await this.readLog.execute({
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(action ? { action } : {}),
      ...(parsedFrom ? { from: parsedFrom } : {}),
      ...(parsedTo ? { to: parsedTo } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });

    if (!outcome.ok) throw new BadRequestException(outcome.error.message);
    void caller;
    return outcome.value;
  }
}
