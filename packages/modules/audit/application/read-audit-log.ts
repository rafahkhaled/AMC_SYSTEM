import { type Result, ValidationFailed, err, ok } from '@amc/kernel';
import type { AuditEntry } from '../domain/index.js';
import type { AuditQuery, AuditReader } from './ports.js';

const MAX_PAGE = 200;

/**
 * Reading the log is itself a privileged action, so the caller's permission is
 * checked here rather than being left to a decorator somebody might omit.
 */
export class ReadAuditLog {
  constructor(private readonly reader: AuditReader) {}

  async execute(
    query: Omit<AuditQuery, 'limit'> & { limit?: number },
  ): Promise<Result<{ entries: AuditEntry[]; nextCursor: string | null }, ValidationFailed>> {
    const limit = query.limit ?? 50;
    if (limit < 1 || limit > MAX_PAGE) {
      return err(new ValidationFailed(`Ask for between 1 and ${MAX_PAGE} entries`, { limit }));
    }
    if (query.from && query.to && query.from > query.to) {
      return err(new ValidationFailed('That date range runs backwards'));
    }
    return ok(await this.reader.search({ ...query, limit }));
  }
}
