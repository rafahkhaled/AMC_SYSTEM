import { Money, Rate } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Client } from './client.js';
import { FinancialYear, VatPeriods } from './tax-period.js';
import { Trn } from './trn.js';

const at = (iso: string) => new Date(iso);
const rate = (major: string) => Rate.perHour(Money.ofMajor(major, 'AED'));
const FIRM_DEFAULT = rate('250.00');

function trn(value = '100123456700003') {
  const parsed = Trn.of(value);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function periods(anchor = 3) {
  const parsed = VatPeriods.of('quarterly', anchor);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.value;
}

function client() {
  const created = Client.onboard({
    id: 'client-1',
    legalName: '  Gulf Trading LLC  ',
    legalNameArabic: 'الخليج للتجارة ذ.م.م',
    now: at('2026-01-10T06:00:00Z'),
  });
  if (!created.ok) throw new Error('fixture');
  created.value.pullEvents();
  return created.value;
}

describe('onboarding a client', () => {
  it('trims the legal name and keeps the Arabic one', () => {
    expect(client().legalName).toBe('Gulf Trading LLC');
    expect(client().snapshot().legalNameArabic).toBe('الخليج للتجارة ذ.م.م');
  });

  it('refuses a client with no legal name', () => {
    expect(Client.onboard({ id: 'c', legalName: '   ', now: at('2026-01-10T06:00:00Z') }).ok).toBe(
      false,
    );
  });

  it('starts registered for nothing, which is the honest default', () => {
    expect(client().vat.state).toBe('not_registered');
    expect(client().corporateTax.state).toBe('not_registered');
  });
});

describe('tax registration', () => {
  it('records the number and the cycle together', () => {
    const subject = client();
    const outcome = subject.registerForVat({
      trn: trn(),
      registeredOn: at('2026-02-01T00:00:00Z'),
      periods: periods(1),
      now: at('2026-02-01T06:00:00Z'),
    });

    expect(outcome.ok).toBe(true);
    expect(subject.vat.trn?.value).toBe('100123456700003');
    // Without the cycle there is no filing date, and a client registered for
    // VAT with no deadline is exactly the one who gets missed.
    expect(subject.vatPeriods?.endMonths()).toEqual([1, 4, 7, 10]);
  });

  it('refuses to register twice', () => {
    const subject = client();
    subject.registerForVat({
      trn: trn(),
      registeredOn: at('2026-02-01T00:00:00Z'),
      periods: periods(),
      now: at('2026-02-01T06:00:00Z'),
    });
    expect(
      subject.registerForVat({
        trn: trn('100999999900003'),
        registeredOn: at('2026-03-01T00:00:00Z'),
        periods: periods(),
        now: at('2026-03-01T06:00:00Z'),
      }).ok,
    ).toBe(false);
  });

  it('keeps the number after deregistration, because old filings still carry it', () => {
    const subject = client();
    subject.registerForVat({
      trn: trn(),
      registeredOn: at('2026-02-01T00:00:00Z'),
      periods: periods(),
      now: at('2026-02-01T06:00:00Z'),
    });
    subject.deregisterFromVat(at('2026-09-30T00:00:00Z'), at('2026-10-01T06:00:00Z'));

    expect(subject.vat.state).toBe('deregistered');
    expect(subject.vat.trn?.value).toBe('100123456700003');
    expect(subject.vat.deregisteredOn?.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('will not deregister a client that was never registered', () => {
    expect(
      client().deregisterFromVat(at('2026-09-30T00:00:00Z'), at('2026-10-01T06:00:00Z')).ok,
    ).toBe(false);
  });

  it('records the financial year with the corporation tax registration', () => {
    const subject = client();
    const year = FinancialYear.endingIn(6);
    if (!year.ok) throw new Error('fixture');

    subject.registerForCorporateTax({
      trn: trn(),
      registeredOn: at('2026-02-01T00:00:00Z'),
      financialYear: year.value,
      now: at('2026-02-01T06:00:00Z'),
    });
    expect(subject.financialYear?.endMonth).toBe(6);
  });
});

describe('the hourly rate and its history (FR-03)', () => {
  it('falls back to the firm default before any rate is set', () => {
    expect(client().rateOn(at('2026-01-15T00:00:00Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
      '250.00',
    );
  });

  it('uses the rate that applied on the day the work was done', () => {
    const subject = client();
    subject.changeRate(
      { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-01-01T06:00:00Z'),
    );
    subject.changeRate(
      { rate: rate('350.00'), effectiveFrom: at('2026-04-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-03-20T06:00:00Z'),
    );

    // March work stays at March's rate for ever, even after April's rise.
    // Otherwise a statement reprinted later would disagree with the one the
    // client already paid.
    expect(subject.rateOn(at('2026-03-31T23:59:59Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
      '300.00',
    );
    expect(subject.rateOn(at('2026-04-01T00:00:00Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
      '350.00',
    );
  });

  it('applies a rate from the moment it takes effect, not when it was entered', () => {
    const subject = client();
    // Entered in March, effective in January: a backdated agreement.
    subject.changeRate(
      { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-03-01T06:00:00Z'),
    );
    expect(subject.rateOn(at('2026-02-01T00:00:00Z'), FIRM_DEFAULT).perHour.toMajorString()).toBe(
      '300.00',
    );
  });

  it('refuses two rates taking effect on the same day', () => {
    const subject = client();
    subject.changeRate(
      { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-01-01T06:00:00Z'),
    );
    // Otherwise "the rate on that day" has two answers and which one wins
    // depends on the order rows come back in.
    expect(
      subject.changeRate(
        { rate: rate('320.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
        at('2026-01-02T06:00:00Z'),
      ).ok,
    ).toBe(false);
  });

  it('keeps every change, so a rate can be explained months later', () => {
    const subject = client();
    subject.changeRate(
      { rate: rate('300.00'), effectiveFrom: at('2026-01-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-01-01T06:00:00Z'),
    );
    subject.changeRate(
      {
        rate: rate('350.00'),
        effectiveFrom: at('2026-04-01T00:00:00Z'),
        changedBy: 'user-1',
        note: 'agreed with the client in the March review',
      },
      at('2026-03-20T06:00:00Z'),
    );

    expect(subject.rates.all).toHaveLength(2);
    expect(subject.rates.all[1]?.note).toContain('March review');
  });

  it('records what changed in a form that reads plainly in the audit log', () => {
    const subject = client();
    subject.changeRate(
      { rate: rate('350.00'), effectiveFrom: at('2026-04-01T00:00:00Z'), changedBy: 'user-1' },
      at('2026-03-20T06:00:00Z'),
    );

    const event = subject.pullEvents().find((e) => e.name === 'clients.client.rate_changed');
    expect(event?.payload).toMatchObject({ perHour: '350.00', currency: 'AED' });
  });
});

describe('client status', () => {
  it('goes dormant and comes back', () => {
    const subject = client();
    subject.markDormant(at('2026-06-01T06:00:00Z'));
    expect(subject.status).toBe('dormant');
    subject.reactivate(at('2026-09-01T06:00:00Z'));
    expect(subject.status).toBe('active');
  });

  it('does not record going dormant twice', () => {
    const subject = client();
    subject.markDormant(at('2026-06-01T06:00:00Z'));
    subject.markDormant(at('2026-06-02T06:00:00Z'));
    expect(
      subject.pullEvents().filter((e) => e.name === 'clients.client.went_dormant'),
    ).toHaveLength(1);
  });
});
