import type { DomainEvent } from './domain-event.js';

/**
 * The handle a repository needs to join the caller's transaction. The concrete
 * shape belongs to the database adapter; the application layer only passes it
 * along.
 */
export interface TransactionContext {
  readonly transactionId: string;
}

/**
 * One transaction, one audit trail, one batch of events.
 *
 * Every write use case runs inside this. The audit rows and the outbox rows are
 * written in the same transaction as the change itself, so a committed change
 * can never be missing its audit entry — which is the whole basis of NFR-05.
 */
export interface UnitOfWork {
  run<T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T>;
}

export interface UnitOfWorkContext {
  readonly transaction: TransactionContext;
  /** Queue an event to be written to the outbox when this transaction commits. */
  collect(events: readonly DomainEvent[]): void;
  /** Record an audited change. Written in the same transaction. */
  audit(entry: AuditEntry): void;
}

export interface AuditEntry {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: Readonly<Record<string, unknown>> | undefined;
  readonly after?: Readonly<Record<string, unknown>> | undefined;
}

/** Who is acting. Carried through every use case for audit and for scoping. */
export interface Actor {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly ipAddress?: string | undefined;
  readonly requestId?: string | undefined;
}
