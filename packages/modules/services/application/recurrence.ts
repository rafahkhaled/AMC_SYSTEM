import { type Clock, type IdGenerator } from '@amc/kernel';
import { type Recurrence, type ServiceCode, Task, templateFor } from '../domain/index.js';
import type { ClientService, ClientServiceRepository, TaskRepository } from './ports.js';

/**
 * A client's own cycles, supplied by whoever calls the sweep.
 *
 * The services module does not read the clients module's tables. It is told
 * the shape of a client's year, which is all it needs and keeps the two
 * modules from growing into each other.
 */
export interface ClientCycle {
  readonly clientId: string;
  /** The period covering a date, and the label that makes it unique. */
  vatPeriodFor?: ((date: Date) => { start: Date; end: Date; key: string }) | undefined;
  /** The last day of the financial year containing a date. */
  financialYearEndFor?: ((date: Date) => Date) | undefined;
  financialYearKeyFor?: ((date: Date) => string) | undefined;
}

export interface CreatedTask {
  readonly taskId: string;
  readonly clientId: string;
  readonly service: ServiceCode;
  readonly periodKey: string;
  readonly dueAt: Date | null;
}

/**
 * Creates the work that comes round again (FR-14).
 *
 * The whole design rests on one thing: every recurring task has a period key,
 * and there can only be one task per subscription per key. That is what makes
 * the sweep safe to run twice, to run late, or to be replayed after an outage
 * without producing a second VAT return for a quarter already handled. Nothing
 * here depends on the sweep running exactly once, because nothing ever does.
 */
export class RecurringWork {
  constructor(
    private readonly subscriptions: ClientServiceRepository,
    private readonly tasks: TaskRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Bring one service up to date for the clients that have it.
   *
   * Returns what it created, which is empty on a second run. A sweep that
   * reports what it did is a sweep an operator can trust.
   */
  async sweep(service: ServiceCode, cycles: Map<string, ClientCycle>): Promise<CreatedTask[]> {
    const template = templateFor(service);
    if (template.recurrence === 'once') return [];

    const now = this.clock.now();
    const created: CreatedTask[] = [];

    for (const subscription of await this.subscriptions.allActive(service)) {
      const period = this.periodFor(template.recurrence, subscription, cycles, now);
      if (!period) continue;

      if (await this.tasks.existsForPeriod(subscription.id, period.key)) continue;

      const task = Task.fromTemplate({
        id: this.ids.next(),
        clientId: subscription.clientId,
        clientServiceId: subscription.id,
        service,
        periodKey: period.key,
        dueAt: period.dueAt,
        now,
      });
      await this.tasks.save(task);

      created.push({
        taskId: task.id,
        clientId: subscription.clientId,
        service,
        periodKey: period.key,
        dueAt: period.dueAt,
      });
    }

    return created;
  }

  private periodFor(
    recurrence: Recurrence,
    subscription: ClientService,
    cycles: Map<string, ClientCycle>,
    now: Date,
  ): { key: string; dueAt: Date | null } | null {
    const cycle = cycles.get(subscription.clientId);

    switch (recurrence) {
      case 'monthly': {
        // The month just finished, not the one running: bookkeeping for
        // September is done in October.
        const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const key = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
        const dueAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 20));
        return { key, dueAt };
      }

      case 'per_vat_period': {
        if (!cycle?.vatPeriodFor) return null;

        /*
         * The period that has most recently closed, found by stepping back
         * from the one running now.
         *
         * Looking at "the period containing last month" seemed right and was
         * not: for a client whose quarter runs August to October, last month
         * is inside the quarter still open, so nothing would ever be created
         * for the quarter that closed in July. Stepping back from today finds
         * the closed one whether the sweep ran last month or not.
         */
        const running = cycle.vatPeriodFor(now);
        const dayBefore = new Date(running.start.getTime() - 86_400_000);
        const closed = cycle.vatPeriodFor(dayBefore);

        if (closed.end.getTime() >= now.getTime()) return null;
        return { key: closed.key, dueAt: vatReturnDueDate(closed.end) };
      }

      case 'per_financial_year': {
        if (!cycle?.financialYearEndFor || !cycle.financialYearKeyFor) return null;

        // Same reasoning as the VAT period: step back from the year that is
        // running to the one that has closed, rather than guessing at an
        // offset that happens to work in some months.
        const runningEnd = cycle.financialYearEndFor(now);
        const closedEnd = new Date(
          Date.UTC(
            runningEnd.getUTCFullYear() - 1,
            runningEnd.getUTCMonth(),
            runningEnd.getUTCDate(),
          ),
        );

        if (closedEnd.getTime() >= now.getTime()) return null;
        return {
          key: cycle.financialYearKeyFor(closedEnd),
          dueAt: corporateTaxDueDate(closedEnd),
        };
      }

      default:
        return null;
    }
  }
}

/**
 * The VAT return is due on the 28th of the month after the period ends
 * (FR-40). The shift for a weekend or a public holiday is applied by the
 * deadline engine, which is the only thing that holds the calendar.
 */
export function vatReturnDueDate(periodEnd: Date): Date {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 28));
}

/** The corporation tax return is due nine months after the year ends. */
export function corporateTaxDueDate(yearEnd: Date): Date {
  return new Date(
    Date.UTC(yearEnd.getUTCFullYear(), yearEnd.getUTCMonth() + 9, yearEnd.getUTCDate()),
  );
}
