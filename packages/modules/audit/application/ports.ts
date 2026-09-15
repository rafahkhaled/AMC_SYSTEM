import type { DomainEvent } from '@amc/kernel';
import type { AuditEntry } from '../domain/index.js';

export interface AuditQuery {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly actorUserId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly cursor?: string;
}

export interface AuditReader {
  search(query: AuditQuery): Promise<{ entries: AuditEntry[]; nextCursor: string | null }>;
}

export interface OutboxRecord {
  readonly id: string;
  readonly event: DomainEvent;
  readonly attempts: number;
}

export interface OutboxReader {
  pending(limit: number): Promise<OutboxRecord[]>;
  markPublished(ids: readonly string[], at: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
