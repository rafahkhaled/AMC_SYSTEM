import { type Clock, type IdGenerator } from '@amc/kernel';
import { Project, type Recurrence, type ServiceCode, templateFor } from '../domain/index.js';
import type { ClientService, ClientServiceRepository, ProjectRepository } from './ports.js';

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

export interface CreatedProject {
  readonly projectId: string;
  readonly clientId: string;
  readonly service: ServiceCode;
  readonly periodKey: string;
  readonly dueAt: Date | null;
}

/**
 * Creates the work that comes round again (FR-14).
 *
 * The whole design rests on one thing: every recurring project has a period key,
 * and there can only be one project per subscription per key. That is what makes
 * the sweep safe to run twice, to run late, or to be replayed after an outage
 * without producing a second VAT return for a quarter already handled. Nothing
 * here depends on the sweep running exactly once, because nothing ever does.
 */
export class RecurringWork {
  constructor(
    private readonly subscriptions: ClientServiceRepository,
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Bring one service up to date for the clients that have it.
   *
   * Returns what it created, which is empty on a second run. A sweep that
   * reports what it did is a sweep an operator can trust.
   */
  async sweep(service: ServiceCode, cycles: Map<string, ClientCycle>): Promise<CreatedProject[]> {
    // Only the eleven in code ever recur. A service the firm added is one-off
    // and has no template here, which reads the same as one that does not recur.
    const template = templateFor(service);
    if (!template || template.recurrence === 'once') return [];

    const now = this.clock.now();
    const created: CreatedProject[] = [];

    for (const subscription of await this.subscriptions.allActive(service)) {
      const period = this.periodFor(template.recurrence, subscription, cycles, now);
      if (!period) continue;

      if (await this.projects.existsForPeriod(subscription.id, period.key)) continue;

      const project = Project.fromTemplate({
        id: this.ids.next(),
        clientId: subscription.clientId,
        clientServiceId: subscription.id,
        service,
        periodKey: period.key,
        dueAt: period.dueAt,
        now,
      });
      await this.projects.save(project);

      created.push({
        projectId: project.id,
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

        // Same reasoning as the VAT period: task back from the year that is
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

/**
 * The corporation tax return is due nine months after the year ends.
 *
 * The day is held to the last day of that month. A year ending on the 31st of
 * December is due on the 30th of September, and adding nine months to the
 * date as it stands lands on "31 September", which the calendar rolls into
 * the 1st of October — a filing deadline shown a day later than it is.
 */
export function corporateTaxDueDate(yearEnd: Date): Date {
  const month = yearEnd.getUTCMonth() + 9;
  const lastDay = new Date(Date.UTC(yearEnd.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(yearEnd.getUTCFullYear(), month, Math.min(yearEnd.getUTCDate(), lastDay)),
  );
}

const DAY = 86_400_000;

/**
 * The period that follows one already worked on (feedback item 9).
 *
 * The sweep opens work for the period that has just *closed*. Somebody who has
 * finished a return and wants to carry on straight away is asking for the one
 * after it — which has not closed, so the sweep will not make it for weeks.
 * This answers with the same key and due date the sweep would give that
 * period once it closed, so opening it by hand and the sweep opening it later
 * are the same project and not two.
 *
 * Null when it cannot be worked out: an unknown key, or a client whose
 * cycle is not on file. Said so rather than guessed, because a wrong period is
 * a filing against the wrong quarter.
 */
export function nextPeriod(
  recurrence: Recurrence,
  periodKey: string,
  cycle: ClientCycle | undefined,
  now: Date,
): { key: string; dueAt: Date | null } | null {
  switch (recurrence) {
    case 'monthly': {
      const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      if (!match) return null;
      const next = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
      const key = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
      // Bookkeeping for a month is due on the 20th of the month after it.
      const dueAt = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 20));
      return { key, dueAt };
    }

    case 'per_vat_period': {
      if (!cycle?.vatPeriodFor) return null;
      // Stepping back from today until the key matches. Periods are labelled,
      // not numbered, so there is no arithmetic that goes from a key to a date.
      let found: { end: Date } | null = null;
      let from = now;
      for (let step = 0; step < 80 && !found; step += 1) {
        const period = cycle.vatPeriodFor(from);
        if (period.key === periodKey) found = period;
        from = new Date(period.start.getTime() - DAY);
      }
      if (!found) return null;

      const next = cycle.vatPeriodFor(new Date(found.end.getTime() + DAY));
      return { key: next.key, dueAt: vatReturnDueDate(next.end) };
    }

    case 'per_financial_year': {
      if (!cycle?.financialYearEndFor || !cycle.financialYearKeyFor) return null;
      let end = cycle.financialYearEndFor(now);
      let found: Date | null = null;
      for (let step = 0; step < 40 && !found; step += 1) {
        if (cycle.financialYearKeyFor(end) === periodKey) found = end;
        // The first of the month a year earlier: the day of the month varies
        // (a February year end), and asking for any date in the month finds it.
        end = cycle.financialYearEndFor(
          new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1)),
        );
      }
      if (!found) return null;

      const nextEnd = cycle.financialYearEndFor(
        new Date(Date.UTC(found.getUTCFullYear() + 1, found.getUTCMonth(), 1)),
      );
      return { key: cycle.financialYearKeyFor(nextEnd), dueAt: corporateTaxDueDate(nextEnd) };
    }

    default:
      return null;
  }
}
