import {
  type Clock,
  Conflict,
  Duration,
  type IdGenerator,
  Money,
  type Result,
  err,
  ok,
} from '@amc/kernel';
import { Statement, type StatementLine } from '../domain/index.js';
import type {
  BillableWork,
  RateReader,
  StatementRepository,
  UnbilledWorkReader,
  WorkAttachment,
} from './ports.js';

export interface GenerateStatementCommand {
  readonly clientId: string;
  readonly from: Date;
  readonly to: Date;
}

/**
 * Turning a period of recorded work into a document (FR-31).
 *
 * The grouping is one line per project, per day, per person. That is not an
 * arbitrary choice: it is the grouping a client can check against their own
 * diary, and the one that lets a dispute be about a single afternoon rather
 * than about a month.
 *
 * Every line is priced at the rate that applied on the day it was worked. Two
 * lines on the same statement can therefore carry different rates, and that is
 * correct — a rate rise in the middle of a month does not reach backwards.
 */
export class GenerateStatement {
  constructor(
    private readonly unbilled: UnbilledWorkReader,
    private readonly rates: RateReader,
    private readonly statements: StatementRepository,
    private readonly attachment: WorkAttachment,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    createdBy: string,
    command: GenerateStatementCommand,
  ): Promise<Result<{ statementId: string; lines: number }, Conflict>> {
    if (command.to.getTime() < command.from.getTime()) {
      return err(new Conflict('A statement period has to end after it starts'));
    }

    const work = await this.unbilled.forClient({
      clientId: command.clientId,
      from: command.from,
      to: command.to,
    });

    if (work.length === 0) {
      /*
       * Nothing to bill is a refusal rather than an empty statement.
       *
       * An empty document raised against a client is worse than none: it looks
       * like an oversight, somebody chases it, and it sits in the list of
       * things to invoice forever.
       */
      return err(new Conflict('There are no approved unbilled hours for that period'));
    }

    const currency = await this.rates.currencyFor(command.clientId);
    const lines: StatementLine[] = [];

    for (const [, group] of this.groupBy(work)) {
      const first = group[0];
      if (!first) continue;

      const worked = Duration.ofSeconds(group.reduce((total, item) => total + item.seconds, 0));
      const entryIds = group.map((item) => item.entryId);

      /*
       * A fee line carries no rate at all.
       *
       * Dividing the fee by the hours to show one would produce a number that
       * moves every time somebody records more time, printed on a document
       * the client reads. The hours stay on the line — they are what P2-11
       * measures the fee against — they simply stop deciding the amount.
       */
      if (first.pricing !== 'hourly') {
        if (first.feeMinor === null) {
          return err(
            new Conflict('A fixed fee or retainer is set for this work but no amount was agreed'),
          );
        }

        lines.push({
          id: this.ids.next(),
          projectId: first.projectId,
          service: first.service,
          performedOn: first.performedOn,
          userId: first.userId,
          worked,
          pricing: { kind: 'fixed', fee: Money.ofMinor(first.feeMinor, currency) },
          entryIds,
          excluded: false,
          excludedReason: null,
          adjustedTo: null,
          adjustedReason: null,
        });
        continue;
      }

      const perHour = await this.rates.perHourOn(command.clientId, first.performedOn);
      if (perHour.currency !== currency) {
        return err(new Conflict('This client has rates in more than one currency; fix that first'));
      }

      lines.push({
        id: this.ids.next(),
        projectId: first.projectId,
        service: first.service,
        performedOn: first.performedOn,
        userId: first.userId,
        worked,
        pricing: { kind: 'hourly', perHour },
        entryIds,
        excluded: false,
        excludedReason: null,
        adjustedTo: null,
        adjustedReason: null,
      });
    }

    const statement = Statement.draft({
      id: this.ids.next(),
      clientId: command.clientId,
      periodStart: command.from,
      periodEnd: command.to,
      currency,
      lines,
      createdBy,
      now: this.clock.now(),
    });
    if (!statement.ok) return err(statement.error);

    await this.statements.save(statement.value);

    /*
     * Attaching comes after the statement exists, because an entry pointing at
     * a line that was never written is an hour frozen against nothing. The
     * other order fails safe: a statement whose hours are not yet attached is
     * merely wrong, and regenerating fixes it.
     */
    for (const line of lines) {
      await this.attachment.attach(line.id, line.entryIds);
    }

    return ok({ statementId: statement.value.id, lines: lines.length });
  }

  /**
   * How the lines are grouped, which depends on how the work is charged.
   *
   * Hourly groups by project, day and person: the grouping a client can check
   * against their own diary, and the one that makes a dispute about a single
   * afternoon rather than about a month.
   *
   * A fixed fee groups by project, because the fee is for the project however
   * many days it took. A retainer groups by subscription and month, because
   * the fee is for the month however many projects fell in it.
   *
   * The day is the calendar date the reader already resolved in the firm's
   * timezone. Grouping on a timestamp would split an evening's work across two
   * lines whenever it crossed midnight UTC — which in Dubai is four in the
   * afternoon.
   */
  private groupBy(work: readonly BillableWork[]): Map<string, BillableWork[]> {
    const groups = new Map<string, BillableWork[]>();
    for (const item of work) {
      const day = item.performedOn.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const key =
        item.pricing === 'retainer'
          ? `retainer|${item.clientServiceId}|${month}`
          : item.pricing === 'fixed'
            ? `fixed|${item.projectId}`
            : `hourly|${item.projectId}|${day}|${item.userId ?? ''}`;

      const existing = groups.get(key);
      if (existing) existing.push(item);
      else groups.set(key, [item]);
    }
    return groups;
  }
}
