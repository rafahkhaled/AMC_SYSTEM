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
  /**
   * The actor is supplied per operation rather than per instance, because one
   * process serves many people and an audit row that names the wrong one is
   * worse than no audit row at all.
   */
  run<T>(actor: Actor, work: (context: UnitOfWorkContext) => Promise<T>): Promise<T>;
}

export interface UnitOfWorkContext {
  readonly transaction: TransactionContext;
  readonly actor: Actor;
  /** Queue an event to be written to the outbox when this transaction commits. */
  collect(events: readonly DomainEvent[]): void;
  /** Record an audited change. Written in the same transaction. */
  audit(entry: AuditEntry): void;
  /**
   * Names the actor once it is known.
   *
   * A sign-in opens its transaction before anyone is identified, because the
   * password has not been checked yet. Without this, a successful sign-in
   * would be recorded against nobody, which is precisely the entry an audit
   * reader most wants attributed.
   */
  identify(actor: Actor): void;
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
  readonly label?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly requestId?: string | undefined;
  readonly sessionId?: string | undefined;
}

/**
 * Somewhere for an aggregate's recorded events to go when it is saved. The
 * repository hands them over; the unit of work decides what happens to them.
 */
export interface EventCollector {
  collect(events: readonly DomainEvent[]): void;
}
