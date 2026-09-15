import { describe, expect, it } from 'vitest';
import {
  ALL_SERVICES,
  SERVICE_TEMPLATES,
  mandatoryDocumentsFor,
  templateFor,
} from './service-template.js';

describe('the eleven services (FR-10)', () => {
  it('has all eleven', () => {
    expect(ALL_SERVICES).toHaveLength(11);
  });

  it('names every one in both languages', () => {
    for (const template of ALL_SERVICES) {
      expect(template.nameEn.length).toBeGreaterThan(0);
      expect(template.nameAr.length).toBeGreaterThan(0);
      // Arabic, not a placeholder someone forgot to translate.
      expect(/[؀-ۿ]/.test(template.nameAr)).toBe(true);
    }
  });

  it('gives every service steps, numbered from one without gaps', () => {
    for (const template of ALL_SERVICES) {
      expect(template.steps.length).toBeGreaterThan(0);
      expect(template.steps.map((step) => step.order)).toEqual(
        template.steps.map((_, index) => index + 1),
      );
    }
  });

  it('translates every step as well as every service', () => {
    for (const template of ALL_SERVICES) {
      for (const step of template.steps) {
        expect(/[؀-ۿ]/.test(step.nameAr)).toBe(true);
      }
    }
  });
});

describe('recurrence (FR-14)', () => {
  it('repeats monthly accounting every month', () => {
    expect(templateFor('monthly_accounting').recurrence).toBe('monthly');
  });

  it('ties the VAT return to the client own period, not the calendar', () => {
    // The FTA staggers the cycles, so "quarterly" alone would be wrong for
    // most clients.
    expect(templateFor('vat_return').recurrence).toBe('per_vat_period');
  });

  it('ties the corporation tax return to the client financial year', () => {
    expect(templateFor('ct_return').recurrence).toBe('per_financial_year');
  });

  it('treats a registration as happening once', () => {
    expect(templateFor('vat_registration').recurrence).toBe('once');
    expect(templateFor('ct_registration').recurrence).toBe('once');
  });
});

describe('deadline rules (FR-40)', () => {
  it('uses the statutory rule for each return', () => {
    expect(templateFor('vat_return').deadline).toEqual({ kind: 'vat_return' });
    expect(templateFor('ct_return').deadline).toEqual({ kind: 'ct_return' });
  });

  it('leaves the authority-driven work to be dated by hand', () => {
    // The FTA sets its own timetable for these, case by case.
    for (const code of ['penalty_waiver', 'vat_refund', 'emaratax_request'] as const) {
      expect(templateFor(code).deadline.kind).toBe('manual');
    }
  });
});

describe('what blocks a task from starting (FR-12)', () => {
  it('requires the founding documents before a VAT registration', () => {
    expect(mandatoryDocumentsFor('vat_registration')).toEqual([
      'trade_licence',
      'emirates_id',
      'passport',
      'memorandum',
    ]);
  });

  it('treats a bank letter as helpful rather than blocking for registration', () => {
    const bankLetter = SERVICE_TEMPLATES.vat_registration.requiredDocuments.find(
      (document) => document.type === 'bank_letter',
    );
    expect(bankLetter?.mandatory).toBe(false);
  });

  it('blocks nothing for an EmaraTax request, which needs no paperwork of ours', () => {
    expect(mandatoryDocumentsFor('emaratax_request')).toEqual([]);
  });
});
