import { Conflict, type Result, err, heldBy, ok } from '@amc/kernel';
import type { CallerLike, StatementRepository, WorkAttachment } from './ports.js';

/**
 * Taking hours back off a statement (FR-26, P2-07).
 *
 * The one permitted change to billed time, and a manager's alone. Everything
 * else about an invoiced hour is frozen — by the domain, and again by a
 * database trigger — because what makes a client statement defensible is that
 * the hours behind it cannot quietly change after it was sent.
 *
 * Releasing is not an edit, it is an undo: the hours go back to the unbilled
 * pool and the statement they were on has to be redone. That is why it needs a
 * reason, why it is restricted, and why it is loud in the audit log.
 */
export class ReleaseFromStatement {
  constructor(
    private readonly statements: StatementRepository,
    private readonly attachment: WorkAttachment,
  ) {}

  async execute(
    caller: CallerLike,
    params: { statementId: string; reason: string },
  ): Promise<Result<{ released: number }, Conflict>> {
    /*
     * Manager only, checked here rather than on the route.
     *
     * A permission enforced only at the edge is one a later caller — a job, a
     * script, another use case — reaches around without noticing.
     */
    if (!heldBy(caller).has('billing.release')) {
      return err(new Conflict('Only a manager can take hours back off a statement'));
    }

    const trimmed = params.reason.trim();
    if (trimmed.length < 3) {
      return err(new Conflict('Say why these hours are being released'));
    }

    const statement = await this.statements.findById(params.statementId);
    if (!statement) return err(new Conflict('There is no such statement'));

    if (statement.currentState === 'invoiced') {
      // The client has the document. Releasing the hours behind it would
      // leave an invoice nobody can reconcile against any recorded work.
      return err(
        new Conflict('That statement has been invoiced; cancel or credit the invoice first'),
      );
    }

    const entryIds = statement.entryIds();
    if (entryIds.length === 0) {
      return err(new Conflict('There are no hours attached to that statement'));
    }

    const cancelled = statement.cancel(trimmed, new Date());
    if (!cancelled.ok) return err(cancelled.error);

    /*
     * Released before the statement is saved.
     *
     * If the release succeeds and the save fails, the hours are loose and the
     * statement still claims them — visible, and the next generation picks
     * them up. The other order leaves hours frozen against a cancelled
     * statement, which nothing will ever free.
     */
    await this.attachment.release(entryIds);
    await this.statements.save(statement);

    return ok({ released: entryIds.length });
  }
}
