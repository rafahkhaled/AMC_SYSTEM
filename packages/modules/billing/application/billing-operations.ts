import type { Actor, CallerLike, UnitOfWork } from '@amc/kernel';
import type { ClientQuotation } from './client-quotation.js';
import type { GenerateStatement } from './generate-statement.js';
import type { ManageQuotations } from './manage-quotations.js';
import type { StatementRepository } from './ports.js';
import type { RaiseInvoice } from './raise-invoice.js';
import type { ReleaseFromStatement } from './release-from-statement.js';
import type { SettleInvoice } from './settle-invoice.js';

/**
 * Everything in this module that changes something, bound to one transaction.
 *
 * Built per unit of work rather than once at start-up, because each of these
 * holds repositories and the repositories have to write to the transaction
 * that is open — and hand their events to the collector that belongs to it.
 */
export interface BillingServices {
  readonly quotations: ManageQuotations;
  readonly generate: GenerateStatement;
  readonly raise: RaiseInvoice;
  readonly settle: SettleInvoice;
  readonly release: ReleaseFromStatement;
  readonly statements: StatementRepository;
  readonly clientQuotations: ClientQuotation;
}

/**
 * The seam that puts billing in the audit log (ADR-0004).
 *
 * Every other module's writes were in the trail and billing's were not: not
 * one `billing.*` row had ever been written. The aggregates recorded their
 * events correctly and the repositories dropped them, because they were built
 * without a collector and nothing wrapped them in a transaction. Approving a
 * statement, raising an invoice, recording a payment and a client accepting a
 * quotation all happened with no record of who did it.
 *
 * One wrapper rather than a method per operation. There are fourteen call
 * sites and a facade mirroring each would be fourteen signatures to keep in
 * step with the services they forward to; this hands the caller the services
 * themselves, already bound to the transaction, so a new operation cannot be
 * added outside the trail by forgetting to wrap it.
 */
export class BillingOperations {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    /** Builds the services against the open transaction's handle and collector. */
    private readonly forTransaction: (db: unknown, collector: unknown) => BillingServices,
  ) {}

  run<T>(caller: CallerLike, work: (billing: BillingServices) => Promise<T>): Promise<T> {
    return this.asActor(actorFrom(caller), work);
  }

  /**
   * The client answering their own quotation, who has no account.
   *
   * `SYSTEM_ACTOR`'s id, because `actor_user_id` must name a real user or
   * nobody, and there is nobody — the label and the roles say which nobody it
   * was, and the event payload carries `decidedBy: 'client'`.
   */
  runAsClient<T>(work: (billing: BillingServices) => Promise<T>): Promise<T> {
    return this.asActor({ userId: 'system', roles: ['client'], label: 'Client, by link' }, work);
  }

  private asActor<T>(actor: Actor, work: (billing: BillingServices) => Promise<T>): Promise<T> {
    return this.unitOfWork.run(actor, async (context) => {
      const services = this.forTransaction((context as unknown as { db: unknown }).db, context);
      return work(services);
    });
  }
}

function actorFrom(caller: CallerLike): Actor {
  return {
    userId: caller.userId,
    roles: [...caller.roles],
    ...(caller.displayName ? { label: caller.displayName } : {}),
  };
}
