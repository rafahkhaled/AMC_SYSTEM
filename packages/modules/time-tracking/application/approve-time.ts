import { type Clock, Conflict, type Result, err, ok } from '@amc/kernel';
import type { TimeEntryRepository } from './ports.js';

/**
 * Approving recorded time, so it can be billed (FR-23, FR-31).
 *
 * The step between a timesheet and a bill. Nothing reaches a statement until
 * somebody senior has looked at it: `unbilledForClient` requires
 * `approved_at`, which is what stops a mistyped eleven-hour afternoon being
 * invoiced to a client before anyone notices it.
 *
 * Approving by id rather than by date range, because the audit record should
 * name exactly what was approved. A range approves whatever happens to be in
 * it, including a row somebody added while the screen was open.
 */
export class ApproveTime {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Approves each entry, and says what it could not do.
   *
   * Not all or nothing. A week's approval where one entry is still running
   * should approve the other nine and say so, rather than refuse the lot and
   * leave somebody to find which one it objected to.
   */
  async execute(
    approver: string,
    entryIds: readonly string[],
  ): Promise<Result<{ approved: string[]; refused: { id: string; because: string }[] }, Conflict>> {
    if (entryIds.length === 0) {
      return err(new Conflict('Nothing was selected to approve'));
    }

    const now = this.clock.now();
    const approved: string[] = [];
    const refused: { id: string; because: string }[] = [];

    for (const id of entryIds) {
      const entry = await this.entries.findById(id);
      if (entry === null) {
        refused.push({ id, because: 'That time entry is not there' });
        continue;
      }

      /*
       * No four-eyes rule here, deliberately.
       *
       * Approving your own hours looks like something to forbid, and in a
       * larger firm it would be. Only `time.edit.any` reaches this, which in
       * this practice is the manager — so a rule that a person cannot approve
       * their own time would leave a single-manager firm permanently unable
       * to bill the manager's own work. The audit row names who approved
       * what, which is the control that actually survives contact with a
       * ten-person office.
       */
      const result = entry.approve(approver, now);
      if (!result.ok) {
        refused.push({ id, because: result.error.message });
        continue;
      }

      await this.entries.save(entry);
      approved.push(id);
    }

    return ok({ approved, refused });
  }
}
