import { describe, expect, it } from 'vitest';
import { codeFor, defineCustomService, isCustomServiceCode } from './custom-service.js';
import { Project } from './project.js';

const valid = {
  nameEn: 'Trademark registration',
  nameAr: 'تسجيل علامة تجارية',
  deadlineDays: 45,
  steps: [
    { nameEn: 'Search the register', nameAr: 'البحث في السجل' },
    { nameEn: 'File the application', nameAr: 'تقديم الطلب' },
  ],
  requiredDocuments: [{ type: 'trade_licence', mandatory: true }],
};

describe('a service the firm adds (feedback item 8)', () => {
  it('becomes a template like any of the eleven', () => {
    const made = defineCustomService('custom_trademark_registration', valid);
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    expect(made.value.recurrence).toBe('once');
    expect(made.value.deadline).toEqual({ kind: 'days_from_start', days: 45 });
    // Numbered from one with no gaps, which is how progress is recorded.
    expect(made.value.tasks.map((task) => task.order)).toEqual([1, 2]);
  });

  it('leaves the date to be set by hand when no number of days is given', () => {
    const made = defineCustomService('custom_x', { ...valid, deadlineDays: null });
    expect(made.ok && made.value.deadline).toEqual({ kind: 'manual' });
  });

  it('needs a name in both languages', () => {
    expect(defineCustomService('custom_x', { ...valid, nameAr: '  ' }).ok).toBe(false);
    expect(defineCustomService('custom_x', { ...valid, nameEn: '' }).ok).toBe(false);
  });

  it('needs at least one step, and ignores blank ones', () => {
    expect(defineCustomService('custom_x', { ...valid, steps: [] }).ok).toBe(false);
    const blank = defineCustomService('custom_x', {
      ...valid,
      steps: [{ nameEn: ' ', nameAr: '' }, ...valid.steps],
    });
    expect(blank.ok && blank.value.tasks).toHaveLength(2);
  });

  it('fills a step described in one language into the other', () => {
    // A blank on whichever screen is not in that language is worse than the
    // same words twice.
    const made = defineCustomService('custom_x', {
      ...valid,
      steps: [{ nameEn: 'Collect the forms', nameAr: '' }],
    });
    expect(made.ok && made.value.tasks[0]?.nameAr).toBe('Collect the forms');
  });

  it('refuses a deadline that is not a sensible number of days', () => {
    for (const deadlineDays of [0, -3, 731, 1.5]) {
      expect(defineCustomService('custom_x', { ...valid, deadlineDays }).ok).toBe(false);
    }
  });

  it('refuses the same document type listed twice', () => {
    const doubled = defineCustomService('custom_x', {
      ...valid,
      requiredDocuments: [
        { type: 'passport', mandatory: true },
        { type: 'passport', mandatory: false },
      ],
    });
    expect(doubled.ok).toBe(false);
  });
});

describe('the code a service is given', () => {
  it('is made from the English name, never typed', () => {
    const code = codeFor('Trademark registration', new Set());
    expect(code.ok && code.value).toBe('custom_trademark_registration');
  });

  it('never reuses one, retired or not, because old work still points at it', () => {
    const taken = new Set(['custom_trademark_registration', 'custom_trademark_registration_2']);
    const code = codeFor('Trademark registration', taken);
    expect(code.ok && code.value).toBe('custom_trademark_registration_3');
  });

  it('refuses a name with no letters or numbers to build a code from', () => {
    expect(codeFor('تسجيل', new Set()).ok).toBe(false);
  });

  it('is recognisable, and a built-in is not mistaken for one', () => {
    expect(isCustomServiceCode('custom_audit_plus')).toBe(true);
    expect(isCustomServiceCode('audit')).toBe(false);
    expect(isCustomServiceCode('custom_')).toBe(false);
    expect(isCustomServiceCode('custom_Bad Code')).toBe(false);
  });
});

describe('starting work from one', () => {
  it('opens with its own steps and waits on its mandatory documents', () => {
    const made = defineCustomService('custom_trademark_registration', valid);
    if (!made.ok) throw made.error;

    const project = Project.fromTemplate({
      id: 'p-1',
      clientId: 'c-1',
      clientServiceId: 'cs-1',
      service: 'custom_trademark_registration',
      template: made.value,
      now: new Date('2026-10-01T08:00:00Z'),
    });

    expect(project.service).toBe('custom_trademark_registration');
    expect(project.tasksRemaining).toBe(2);
    expect(project.status).toBe('awaiting_documents');
    expect(project.missingDocuments).toEqual(['trade_licence']);
  });

  it('will not start for a service nobody has a template for', () => {
    expect(() =>
      Project.fromTemplate({
        id: 'p-1',
        clientId: 'c-1',
        clientServiceId: 'cs-1',
        service: 'custom_ghost',
        now: new Date(),
      }),
    ).toThrow(/No template/);
  });
});
