import {
  Conflict,
  type EventCollector,
  type UnitOfWork,
  type UnitOfWorkContext,
} from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import type { TemplateState } from '../domain/index.js';
import {
  type LetterTemplateAdminRepository,
  ManageLetterTemplates,
} from './manage-letter-templates.js';
import type { CallerLike } from './ports.js';

const manager = {
  userId: 'u-1',
  displayName: 'Wael Ajam',
  roles: ['manager'],
  permissions: ['users.manage'],
} as unknown as CallerLike;

const wording = {
  nameEn: 'Salary certificate request',
  nameAr: 'طلب شهادة راتب',
  bodyEn: '{{today}}\n\nTo: {{client_name}}\nTrade licence: {{trade_licence}}\n\n{{signatory}}',
  bodyAr: '{{today}}\n\nإلى: {{client_name}}\nالرخصة: {{trade_licence}}\n\n{{signatory}}',
};

function harness(seed: TemplateState[] = []) {
  const rows = [...seed];
  const events: string[] = [];
  const repository: LetterTemplateAdminRepository = {
    all: async () => [...rows],
    findByCode: async (code) => rows.find((row) => row.code === code) ?? null,
    insert: async (template) => {
      rows.push(template);
    },
    update: async (template) => {
      rows[rows.findIndex((row) => row.id === template.id)] = template;
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

  let next = 0;
  const manage = new ManageLetterTemplates(
    unitOfWork,
    { forTransaction: (_db: unknown, _collector: EventCollector) => repository },
    repository,
    { next: () => `tpl-${++next}` },
  );
  return { manage, rows, events };
}

describe('adding a letter (feedback item 6)', () => {
  it('stores it under a code made from the English name, and records who did it', async () => {
    const h = harness();
    const added = await h.manage.add(manager, wording);

    expect(added.ok && added.value).toBe('salary_certificate_request');
    expect(h.rows).toHaveLength(1);
    expect(h.events).toEqual(['clients.letter_template.added']);
  });

  it('lists it with the facts it needs, from either language', async () => {
    const h = harness();
    await h.manage.add(manager, wording);

    const [listed] = await h.manage.all();
    expect(listed?.needs.sort()).toEqual(['client_name', 'signatory', 'today', 'trade_licence']);
    expect(listed?.retired).toBe(false);
  });

  it('never reuses a code, so two letters of one name stay two letters', async () => {
    const h = harness();
    await h.manage.add(manager, wording);
    const second = await h.manage.add(manager, wording);
    expect(second.ok && second.value).toBe('salary_certificate_request_2');
  });

  it('needs wording in both languages, because the letter is made in whichever the client reads', async () => {
    const h = harness();
    expect((await h.manage.add(manager, { ...wording, bodyAr: '   ' })).ok).toBe(false);
    expect((await h.manage.add(manager, { ...wording, nameAr: '' })).ok).toBe(false);
    expect(h.rows).toHaveLength(0);
  });

  it('refuses a placeholder the system cannot fill in, and names it', async () => {
    // `renderLetter` would leave `{{client_nme}}` in the letter exactly as
    // written, and it would go to a client with the braces still in it.
    const h = harness();
    const refused = await h.manage.add(manager, {
      ...wording,
      bodyEn: 'Dear {{client_nme}}, we write about {{director_name}}.',
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.message).toContain('{{client_nme}}');
      expect(refused.error.message).toContain('{{director_name}}');
      // And says what it can fill in, so the fix does not need guessing.
      expect(refused.error.message).toContain('{{client_name}}');
    }
    expect(h.events).toEqual([]);
  });

  it('checks the Arabic wording as well as the English', async () => {
    const h = harness();
    const refused = await h.manage.add(manager, { ...wording, bodyAr: 'إلى {{cleint_name}}' });
    expect(refused.ok).toBe(false);
  });

  it('refuses a name with no letters or numbers to build a code from', async () => {
    const h = harness();
    expect((await h.manage.add(manager, { ...wording, nameEn: '!!!' })).ok).toBe(false);
  });
});

describe('changing a letter', () => {
  async function added() {
    const h = harness();
    const made = await h.manage.add(manager, wording);
    if (!made.ok) throw made.error;
    h.events.length = 0;
    return { h, code: made.value };
  }

  it('rewords it, keeping the code, and says so in the audit trail', async () => {
    const { h, code } = await added();
    const changed = await h.manage.change(manager, code, {
      bodyEn: 'New wording for {{client_name}}',
    });

    expect(changed.ok).toBe(true);
    expect(h.rows[0]?.bodyEn).toBe('New wording for {{client_name}}');
    expect(h.rows[0]?.code).toBe('salary_certificate_request');
    expect(h.events).toEqual(['clients.letter_template.changed']);
  });

  it('leaves what it was not asked to change', async () => {
    const { h, code } = await added();
    await h.manage.change(manager, code, { nameEn: 'Salary certificate' });

    expect(h.rows[0]?.nameAr).toBe(wording.nameAr);
    expect(h.rows[0]?.bodyAr).toBe(wording.bodyAr);
  });

  it('applies the same checks to a rewording as to a new letter', async () => {
    const { h, code } = await added();
    const refused = await h.manage.change(manager, code, { bodyEn: 'Hello {{nobody}}' });

    expect(refused.ok).toBe(false);
    expect(h.rows[0]?.bodyEn).toBe(wording.bodyEn);
    expect(h.events).toEqual([]);
  });

  it('retires it and brings it back, each as its own event', async () => {
    const { h, code } = await added();
    await h.manage.change(manager, code, { retired: true });
    expect(h.rows[0]?.retiredAt).not.toBeNull();

    await h.manage.change(manager, code, { retired: false });
    expect(h.rows[0]?.retiredAt).toBeNull();
    expect(h.events).toEqual([
      'clients.letter_template.retired',
      'clients.letter_template.restored',
    ]);
  });

  it('can change the seeded letters the firm started with, not only ones it added', async () => {
    const h = harness([
      {
        id: 'tpl-engagement',
        code: 'engagement_letter',
        nameEn: 'Engagement letter',
        nameAr: 'خطاب التكليف',
        bodyEn: 'Dear {{client_name}}',
        bodyAr: 'السادة {{client_name}}',
        retiredAt: null,
      },
    ]);
    expect((await h.manage.change(manager, 'engagement_letter', { bodyEn: 'Dear Sirs' })).ok).toBe(
      true,
    );
  });

  it('says so for a letter that is not there', async () => {
    const h = harness();
    const refused = await h.manage.change(manager, 'ghost', { retired: true });
    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({ error: expect.any(Conflict) });
  });
});
