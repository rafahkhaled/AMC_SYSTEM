import type { Database } from '@amc/database';
import type {
  Actor,
  AuditEntry as AuditDraft,
  Clock,
  DomainEvent,
  IdGenerator,
  UnitOfWork,
  UnitOfWorkContext,
} from '@amc/kernel';
import { redact } from '../domain/index.js';
import { auditLog, outbox } from './schema.js';

/** The transaction handle, which is a Database bound to one transaction. */
export type TransactionalDatabase = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface AmcUnitOfWorkContext extends UnitOfWorkContext {
  /** Repositories are built against this, so every write joins the transaction. */
  readonly db: TransactionalDatabase;
}

/**
 * One transaction, one audit trail, one batch of events.
 *
 * This is where ADR-0004 is actually kept rather than merely asserted: the
 * audit rows and the outbox rows are inserted in the same transaction as the
 * change itself. A committed change therefore cannot be missing its audit
 * entry, and an event can never describe something that was rolled back.
 *
 * Every domain event an aggregate recorded becomes an audit row, because
 * anything worth telling another module about is worth recording. Explicit
 * entries cover what is not a domain event at all: reading a credential,
 * exporting a file, looking at something sensitive.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async run<T>(actor: Actor, work: (context: AmcUnitOfWorkContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const events: DomainEvent[] = [];
      const drafts: AuditDraft[] = [];
      // Refined during the work when the actor becomes known, and read only
      // at the end, so every row in this transaction names the same person.
      let current: Actor = actor;

      const context: AmcUnitOfWorkContext = {
        db: tx,
        actor,
        transaction: { transactionId: this.ids.next() },
        collect: (recorded) => {
          events.push(...recorded);
        },
        audit: (entry) => {
          drafts.push(entry);
        },
        identify: (identified) => {
          current = identified;
        },
      };

      const result = await work(context);
      const now = this.clock.now();
      const acting = current;

      const rows = [
        ...events.map((event) => ({
          id: this.ids.next(),
          occurredAt: event.occurredAt,
          actorUserId: acting.userId === 'system' ? null : acting.userId,
          actorRoles: [...acting.roles],
          actorLabel: acting.label ?? null,
          action: event.name,
          entityType: entityTypeOf(event.name),
          entityId: event.aggregateId,
          before: null,
          after: redact(event.payload as Record<string, unknown>),
          ipAddress: acting.ipAddress ?? null,
          requestId: acting.requestId ?? null,
          sessionId: acting.sessionId ?? null,
        })),
        ...drafts.map((draft) => ({
          id: this.ids.next(),
          occurredAt: now,
          actorUserId: acting.userId === 'system' ? null : acting.userId,
          actorRoles: [...acting.roles],
          actorLabel: acting.label ?? null,
          action: draft.action,
          entityType: draft.entityType,
          entityId: draft.entityId,
          before: redact(draft.before as Record<string, unknown> | null | undefined),
          after: redact(draft.after as Record<string, unknown> | null | undefined),
          ipAddress: acting.ipAddress ?? null,
          requestId: acting.requestId ?? null,
          sessionId: acting.sessionId ?? null,
        })),
      ];

      if (rows.length > 0) await tx.insert(auditLog).values(rows);

      if (events.length > 0) {
        await tx.insert(outbox).values(
          events.map((event) => ({
            id: this.ids.next(),
            occurredAt: event.occurredAt,
            name: event.name,
            aggregateId: event.aggregateId,
            payload: (event.payload ?? {}) as Record<string, unknown>,
          })),
        );
      }

      return result;
    });
  }
}

/**
 * "identity.session.revoked" describes a session. The middle segment names the
 * thing, which keeps event names and audit entity types in step without a
 * second list to maintain.
 */
export function entityTypeOf(eventName: string): string {
  const parts = eventName.split('.');
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}` : (parts[0] ?? 'unknown');
}
