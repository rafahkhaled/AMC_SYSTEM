import {
  Conflict,
  type EventCollector,
  type UnitOfWork,
  type UnitOfWorkContext,
} from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { ALL_SERVICES, Project, templateFor } from '../domain/index.js';
import { ContinueWork } from './continue-work.js';
import type {
  CallerLike,
  ClientService,
  ClientServiceRepository,
  ProjectRepository,
  ServiceCatalogue,
} from './ports.js';
import { type ClientCycle, RecurringWork, corporateTaxDueDate, nextPeriod } from './recurrence.js';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const accountant = {
  userId: 'u-1',
  displayName: 'Layla',
  roles: ['accountant'],
  permissions: ['projects.edit', 'projects.view.all'],
} as unknown as CallerLike;
const noEdit = { ...accountant, permissions: [] } as unknown as CallerLike;

/**
 * Quarters ending in March, June, September and December, labelled the way the
 * clients module labels them. Written out here rather than imported: the
 * services module is told a client's cycle and does not depend on the module
 * that knows how to build one.
 */
const quarterly: ClientCycle = {
  clientId: 'c-1',
  vatPeriodFor: (date) => {
    const month = date.getUTCMonth();
    const endMonth = Math.floor(month / 3) * 3 + 2;
    const year = date.getUTCFullYear();
    return {
      start: new Date(Date.UTC(year, endMonth - 2, 1)),
      end: new Date(Date.UTC(year, endMonth + 1, 0)),
      key: `${year}-Q${Math.floor(month / 3) + 1}`,
    };
  },
};

const yearEndsDecember: ClientCycle = {
  clientId: 'c-1',
  financialYearEndFor: (date) => new Date(Date.UTC(date.getUTCFullYear(), 11, 31)),
  financialYearKeyFor: (date) => `FY${date.getUTCFullYear()}`,
};

describe('the period after one already worked on (feedback item 9)', () => {
  it('goes to the next month, with the due date the sweep would give it', () => {
    expect(nextPeriod('monthly', '2026-09', undefined, day('2026-10-10'))).toEqual({
      key: '2026-10',
      // September's books are due on the 20th of October; October's, in November.
      dueAt: day('2026-11-20'),
    });
  });

  it('rolls December into January', () => {
    expect(nextPeriod('monthly', '2026-12', undefined, day('2027-01-05'))?.key).toBe('2027-01');
  });

  it('goes to the next VAT quarter, due the 28th of the month after it ends', () => {
    expect(nextPeriod('per_vat_period', '2026-Q2', quarterly, day('2026-10-10'))).toEqual({
      key: '2026-Q3',
      dueAt: day('2026-10-28'),
    });
  });

  it('crosses a year end', () => {
    expect(nextPeriod('per_vat_period', '2026-Q4', quarterly, day('2027-02-01'))?.key).toBe(
      '2027-Q1',
    );
  });

  it('goes to the next financial year, due nine months after it ends', () => {
    expect(nextPeriod('per_financial_year', 'FY2025', yearEndsDecember, day('2026-10-10'))).toEqual(
      { key: 'FY2026', dueAt: day('2027-09-30') },
    );
  });

  it('says it cannot rather than guessing when the client’s cycle is not on file', () => {
    // A wrong quarter is a filing against the wrong period.
    expect(nextPeriod('per_vat_period', '2026-Q2', undefined, day('2026-10-10'))).toBeNull();
    expect(nextPeriod('per_financial_year', 'FY2025', undefined, day('2026-10-10'))).toBeNull();
  });

  it('says it cannot for a key it has never heard of', () => {
    expect(nextPeriod('monthly', 'not-a-month', undefined, day('2026-10-10'))).toBeNull();
    expect(nextPeriod('per_vat_period', '1999-Q9', quarterly, day('2026-10-10'))).toBeNull();
    expect(nextPeriod('once', '2026-09', undefined, day('2026-10-10'))).toBeNull();
  });
});

describe('opening it by hand and the sweep opening it later', () => {
  /*
   * The property the whole feature rests on: the key given to a period by
   * hand is the key the sweep gives it once it closes. If they differ, the
   * sweep opens the period a second time and somebody files it twice.
   */
  it('are the same project, for a VAT quarter', async () => {
    const byHand = nextPeriod('per_vat_period', '2026-Q2', quarterly, day('2026-10-10'));

    const made: { key: string; dueAt: Date | null }[] = [];
    const subscription: ClientService = {
      id: 'cs-1',
      clientId: 'c-1',
      service: 'vat_return',
      activeFrom: day('2025-01-01'),
      activeTo: null,
    };
    const sweep = new RecurringWork(
      { allActive: async () => [subscription] } as unknown as ClientServiceRepository,
      {
        existsForPeriod: async () => false,
        save: async (project: Project) => {
          made.push({ key: project.snapshot().periodKey ?? '', dueAt: project.snapshot().dueAt });
        },
      } as unknown as ProjectRepository,
      { now: () => day('2027-01-10') },
      { next: () => 'p' },
    );
    await sweep.sweep('vat_return', new Map([['c-1', quarterly]]));

    // In January 2027, the quarter that has just closed is the one ending in December... and
    // the one by hand was Q3 2026, which closed in September. Step the clock to when Q3 had
    // just closed, as the sweep would have seen it.
    made.length = 0;
    const october = new RecurringWork(
      { allActive: async () => [subscription] } as unknown as ClientServiceRepository,
      {
        existsForPeriod: async () => false,
        save: async (project: Project) => {
          made.push({ key: project.snapshot().periodKey ?? '', dueAt: project.snapshot().dueAt });
        },
      } as unknown as ProjectRepository,
      { now: () => day('2026-10-02') },
      { next: () => 'p' },
    );
    await october.sweep('vat_return', new Map([['c-1', quarterly]]));

    expect(made[0]).toEqual(byHand);
  });

  it('are the same project, for a month', async () => {
    const byHand = nextPeriod('monthly', '2026-08', undefined, day('2026-10-10'));
    const made: { key: string; dueAt: Date | null }[] = [];
    const sweep = new RecurringWork(
      {
        allActive: async () => [
          {
            id: 'cs-1',
            clientId: 'c-1',
            service: 'monthly_accounting',
            activeFrom: day('2025-01-01'),
            activeTo: null,
          },
        ],
      } as unknown as ClientServiceRepository,
      {
        existsForPeriod: async () => false,
        save: async (project: Project) => {
          made.push({ key: project.snapshot().periodKey ?? '', dueAt: project.snapshot().dueAt });
        },
      } as unknown as ProjectRepository,
      // September is "the month just finished" through October.
      { now: () => day('2026-10-03') },
      { next: () => 'p' },
    );
    await sweep.sweep('monthly_accounting', new Map());

    expect(made[0]).toEqual(byHand);
  });
});

/* ---------------------------------------------------------------- the use case */

function finishedProject(
  over: { service?: string; periodKey?: string | null; state?: 'completed' | 'in_progress' } = {},
) {
  const service = over.service ?? 'vat_return';
  const project = Project.fromTemplate({
    id: 'p-1',
    clientId: 'c-1',
    clientServiceId: 'cs-1',
    service,
    periodKey: over.periodKey === undefined ? '2026-Q2' : over.periodKey,
    now: day('2026-07-05'),
  });
  // Walk it to the end the way a person would.
  for (const type of project.missingDocuments)
    project.attachDocument(type, `doc-${type}`, day('2026-07-05'));
  if ((over.state ?? 'completed') === 'completed') {
    project.start(day('2026-07-06'));
    project.moveTo('completed', day('2026-08-01'));
  }
  project.pullEvents();
  return project;
}

function harness(
  project: Project,
  options: { subscribed?: boolean; cycle?: ClientCycle | undefined } = {},
) {
  const saved: Project[] = [];
  const events: string[] = [];
  const ended: { id: string; on: Date }[] = [];
  const subscribed: { clientId: string; service: string }[] = [];
  let live = options.subscribed ?? true;

  const projects = {
    findById: async (id: string, scope: { kind: string }) =>
      scope.kind === 'none' || id !== project.id ? null : project,
    existsForPeriod: async (_cs: string, key: string) =>
      saved.some((one) => one.snapshot().periodKey === key),
    save: async (one: Project) => {
      saved.push(one);
    },
  } as unknown as ProjectRepository;

  const subscriptions: ClientServiceRepository = {
    activeFor: async () =>
      live
        ? [
            {
              id: 'cs-1',
              clientId: 'c-1',
              service: project.service,
              activeFrom: day('2025-01-01'),
              activeTo: null,
            },
          ]
        : [],
    allActive: async () => [],
    subscribe: async (params) => {
      live = true;
      subscribed.push({ clientId: params.clientId, service: params.service });
      return { ...params, activeTo: null };
    },
    end: async (id, on) => {
      live = false;
      ended.push({ id, on });
    },
  };

  const unitOfWork = {
    run: async (_actor: unknown, work: (context: UnitOfWorkContext) => Promise<unknown>) =>
      work({
        collect: (collected: readonly { name: string }[]) => {
          for (const event of collected) events.push(event.name);
        },
      } as unknown as UnitOfWorkContext),
  } as unknown as UnitOfWork;

  const catalogue: ServiceCatalogue = {
    find: async (code) => templateFor(code) ?? null,
    offered: async () => [...ALL_SERVICES],
    retired: async () => [],
  };

  let n = 0;
  const work = new ContinueWork(
    unitOfWork,
    {
      forTransaction: (_db: unknown, _collector: EventCollector) => ({ projects, subscriptions }),
    },
    catalogue,
    { cycleFor: async () => ('cycle' in options ? options.cycle : quarterly) },
    { next: () => `new-${++n}` },
  );
  return { work, saved, events, ended, subscribed };
}

describe('opening the next one', () => {
  it('opens the following period for the same client, as ready work', async () => {
    const h = harness(finishedProject());
    const opened = await h.work.openNext(accountant, 'p-1');

    expect(opened.ok).toBe(true);
    const created = h.saved[0]?.snapshot();
    expect(created).toMatchObject({
      clientId: 'c-1',
      clientServiceId: 'cs-1',
      service: 'vat_return',
      periodKey: '2026-Q3',
    });
    expect(created?.dueAt?.toISOString().slice(0, 10)).toBe('2026-10-28');
    // The audit trail says a project was created; the same event the sweep writes.
    expect(h.saved[0]?.pullEvents().map((event) => event.name)).toContain(
      'services.project.created',
    );
  });

  it('will not open one that already exists, and says which', async () => {
    const h = harness(finishedProject());
    await h.work.openNext(accountant, 'p-1');
    const again = await h.work.openNext(accountant, 'p-1');

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('2026-Q3 is already open');
    expect(h.saved).toHaveLength(1);
  });

  it('says it cannot work the period out, instead of guessing', async () => {
    const h = harness(finishedProject(), { cycle: undefined });
    const refused = await h.work.openNext(accountant, 'p-1');

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('cannot be worked out');
    expect(h.saved).toHaveLength(0);
  });

  it('only for a job that is finished', async () => {
    const h = harness(finishedProject({ state: 'in_progress' }));
    const refused = await h.work.openNext(accountant, 'p-1');
    expect(refused.ok).toBe(false);
  });

  it('not for a service that is done once, which has nothing to repeat', async () => {
    const h = harness(finishedProject({ service: 'deregistration', periodKey: null }));
    const refused = await h.work.openNext(accountant, 'p-1');

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('done once');
  });

  it('opens it even after they stopped it repeating, because those are separate decisions', async () => {
    const h = harness(finishedProject(), { subscribed: false });
    expect((await h.work.openNext(accountant, 'p-1')).ok).toBe(true);
  });

  it('reads a project the caller may not reach as not there', async () => {
    const h = harness(finishedProject());
    const refused = await h.work.openNext(noEdit, 'p-1');

    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({ error: expect.any(Conflict) });
    expect(h.saved).toHaveLength(0);
  });
});

describe('a one-time job', () => {
  it('ends the engagement, so the sweep stops opening it', async () => {
    const h = harness(finishedProject());
    const stopped = await h.work.stopRepeating(accountant, 'p-1');

    expect(stopped.ok).toBe(true);
    expect(h.ended).toHaveLength(1);
    expect(h.ended[0]?.id).toBe('cs-1');
    expect(h.events).toEqual(['services.subscription.stopped']);
  });

  it('is refused when it is already stopped, so the audit log does not say it twice', async () => {
    const h = harness(finishedProject(), { subscribed: false });
    expect((await h.work.stopRepeating(accountant, 'p-1')).ok).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('can be undone, by engaging them for the service again', async () => {
    const h = harness(finishedProject());
    await h.work.stopRepeating(accountant, 'p-1');
    const resumed = await h.work.resumeRepeating(accountant, 'p-1');

    expect(resumed.ok).toBe(true);
    expect(h.subscribed).toEqual([{ clientId: 'c-1', service: 'vat_return' }]);
    expect(h.events).toEqual(['services.subscription.stopped', 'services.subscription.resumed']);
  });

  it('cannot resume what is already repeating', async () => {
    const h = harness(finishedProject());
    expect((await h.work.resumeRepeating(accountant, 'p-1')).ok).toBe(false);
  });

  it('is not offered for a job that is still open', async () => {
    const h = harness(finishedProject({ state: 'in_progress' }));
    expect((await h.work.stopRepeating(accountant, 'p-1')).ok).toBe(false);
    expect(h.ended).toEqual([]);
  });
});

describe('the corporation tax due date', () => {
  it('is the 30th of September for a 31 December year end, not the 1st of October', () => {
    expect(corporateTaxDueDate(day('2026-12-31'))).toEqual(day('2027-09-30'));
  });

  it('keeps the same day where the month is long enough', () => {
    expect(corporateTaxDueDate(day('2026-03-15'))).toEqual(day('2026-12-15'));
  });

  it('holds a 31st to a 30-day month and to February', () => {
    expect(corporateTaxDueDate(day('2026-05-31'))).toEqual(day('2027-02-28'));
    expect(corporateTaxDueDate(day('2027-05-31'))).toEqual(day('2028-02-29'));
    expect(corporateTaxDueDate(day('2026-08-31'))).toEqual(day('2027-05-31'));
  });
});
