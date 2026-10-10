import {
  Conflict,
  type EventCollector,
  type UnitOfWork,
  type UnitOfWorkContext,
} from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import {
  type CustomServiceRepository,
  ManageServices,
  type StoredService,
} from './manage-services.js';
import type { CallerLike } from './ports.js';

const caller = {
  userId: 'u-1',
  displayName: 'Wael Ajam',
  roles: ['manager'],
  permissions: ['users.manage'],
} as unknown as CallerLike;

const input = {
  nameEn: 'Trademark registration',
  nameAr: 'تسجيل علامة تجارية',
  deadlineDays: 45,
  steps: [
    { nameEn: 'Search', nameAr: 'بحث' },
    { nameEn: 'File', nameAr: 'تقديم' },
  ],
  requiredDocuments: [{ type: 'trade_licence', mandatory: true }],
};

function harness(documentTypes = ['trade_licence', 'passport']) {
  const rows: StoredService[] = [];
  const events: string[] = [];

  const repository: CustomServiceRepository = {
    all: async () => [...rows],
    find: async (code) => rows.find((row) => row.template.code === code) ?? null,
    insert: async ({ template, deadlineDays }) => {
      rows.push({ template, deadlineDays, retired: false });
    },
    update: async ({ template, deadlineDays, retired }) => {
      const index = rows.findIndex((row) => row.template.code === template.code);
      rows[index] = { template, deadlineDays, retired };
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

  const manage = new ManageServices(
    unitOfWork,
    { forTransaction: (_db: unknown, _collector: EventCollector) => repository },
    { known: async () => new Set(documentTypes) },
    new Set(['audit', 'vat_return']),
  );
  return { manage, rows, events };
}

describe('adding a service', () => {
  it('stores it, gives it a generated code, and records who did it', async () => {
    const h = harness();
    const added = await h.manage.add(caller, input);

    expect(added.ok && added.value).toBe('custom_trademark_registration');
    expect(h.rows).toHaveLength(1);
    // The unit of work turns each event into an audit row.
    expect(h.events).toEqual(['services.service.added']);
  });

  it('gives a second service of the same name a different code', async () => {
    const h = harness();
    await h.manage.add(caller, input);
    const second = await h.manage.add(caller, input);

    expect(second.ok && second.value).toBe('custom_trademark_registration_2');
  });

  it('refuses a required document that is not on the list', async () => {
    const h = harness();
    const refused = await h.manage.add(caller, {
      ...input,
      requiredDocuments: [{ type: 'made_up_type', mandatory: true }],
    });

    expect(refused.ok).toBe(false);
    expect(h.rows).toHaveLength(0);
    expect(h.events).toEqual([]);
  });
});

describe('changing one', () => {
  async function added() {
    const h = harness();
    const made = await h.manage.add(caller, input);
    if (!made.ok) throw made.error;
    h.events.length = 0;
    return { h, code: made.value };
  }

  it('renames it and may add steps', async () => {
    const { h, code } = await added();
    const changed = await h.manage.change(caller, code, {
      nameEn: 'Trademark filing',
      steps: [...input.steps, { nameEn: 'Pay the fee', nameAr: 'سداد الرسوم' }],
    });

    expect(changed.ok).toBe(true);
    expect(h.rows[0]?.template.nameEn).toBe('Trademark filing');
    expect(h.rows[0]?.template.tasks).toHaveLength(3);
    expect(h.events).toEqual(['services.service.changed']);
  });

  it('will not remove a step, because open projects record progress by number', async () => {
    const { h, code } = await added();
    const refused = await h.manage.change(caller, code, {
      steps: input.steps.slice(0, 1),
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('not removed');
    expect(h.rows[0]?.template.tasks).toHaveLength(2);
  });

  it('retires it and brings it back, each as its own event', async () => {
    const { h, code } = await added();
    await h.manage.change(caller, code, { retired: true });
    expect(h.rows[0]?.retired).toBe(true);

    await h.manage.change(caller, code, { retired: false });
    expect(h.rows[0]?.retired).toBe(false);
    expect(h.events).toEqual(['services.service.retired', 'services.service.restored']);
  });

  it('leaves the eleven in code alone', async () => {
    const h = harness();
    const refused = await h.manage.change(caller, 'vat_return', { nameEn: 'Something else' });
    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({ error: expect.any(Conflict) });
  });

  it('says so for a service that is not there', async () => {
    const h = harness();
    expect((await h.manage.change(caller, 'custom_ghost', { retired: true })).ok).toBe(false);
  });
});
