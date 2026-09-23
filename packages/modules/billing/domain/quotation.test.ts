import { Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Quotation, type QuotationLine, lineTotal } from './quotation.js';

const now = new Date('2026-09-21T08:00:00.000Z');
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

function draft(over: Partial<Parameters<typeof Quotation.draft>[0]> = {}) {
  const made = Quotation.draft({
    id: 'q-1',
    clientId: 'c-1',
    reference: 'Q-2026-014',
    currency: 'AED',
    createdBy: 'u-1',
    validUntil: later(30),
    now,
    ...over,
  });
  if (!made.ok) throw made.error;
  return made.value;
}

const hoursLine = (over: Partial<QuotationLine> = {}): QuotationLine => ({
  id: 'l-1',
  descriptionEn: 'VAT registration',
  descriptionAr: 'التسجيل الضريبي',
  pricing: { kind: 'hours', hours: 4, perHour: aed(25_000) },
  ...over,
});

const fixedLine = (over: Partial<QuotationLine> = {}): QuotationLine => ({
  id: 'l-2',
  descriptionEn: 'Annual audit',
  descriptionAr: 'التدقيق السنوي',
  pricing: { kind: 'fixed', amount: aed(500_000) },
  ...over,
});

describe('what a line comes to', () => {
  it('multiplies an hourly estimate by the rate', () => {
    expect(lineTotal({ kind: 'hours', hours: 4, perHour: aed(25_000) }).minorUnits).toBe(100_000);
  });

  it('handles a half hour without floating point', () => {
    // 3.5 hours at 123.45 is 432.075, which has to round one way by one rule
    // rather than however a float landed.
    const total = lineTotal({ kind: 'hours', hours: 3.5, perHour: aed(12_345) });
    expect(total.minorUnits).toBe(43_208);
  });

  it('takes a fixed amount as it is', () => {
    expect(lineTotal({ kind: 'fixed', amount: aed(500_000) }).minorUnits).toBe(500_000);
  });
});

describe('drafting', () => {
  it('starts empty, as a draft, worth nothing', () => {
    const quotation = draft();
    expect(quotation.currentState).toBe('draft');
    expect(quotation.total().isZero()).toBe(true);
  });

  it('needs a reference the client can quote back', () => {
    const made = Quotation.draft({
      id: 'q-2',
      clientId: 'c-1',
      reference: '   ',
      currency: 'AED',
      createdBy: 'u-1',
      now,
    });
    expect(made.ok).toBe(false);
  });

  it('adds up its lines', () => {
    const quotation = draft();
    expect(quotation.addLine(hoursLine()).ok).toBe(true);
    expect(quotation.addLine(fixedLine()).ok).toBe(true);
    expect(quotation.total().minorUnits).toBe(600_000);
  });

  it('refuses a line with no description in either language', () => {
    const quotation = draft();
    const refused = quotation.addLine(hoursLine({ descriptionEn: ' ', descriptionAr: ' ' }));
    expect(refused.ok).toBe(false);
  });

  it('accepts a line described in only one language', () => {
    // A firm drafting quickly in Arabic should not be blocked; the letter
    // generator fills the other side later.
    const quotation = draft();
    expect(quotation.addLine(hoursLine({ descriptionEn: '' })).ok).toBe(true);
  });

  it('refuses an estimate of no hours', () => {
    const quotation = draft();
    const refused = quotation.addLine(
      hoursLine({ pricing: { kind: 'hours', hours: 0, perHour: aed(25_000) } }),
    );
    expect(refused.ok).toBe(false);
  });

  it('refuses a negative amount', () => {
    const quotation = draft();
    const refused = quotation.addLine(fixedLine({ pricing: { kind: 'fixed', amount: aed(-1) } }));
    expect(refused.ok).toBe(false);
  });

  it('refuses a line in another currency', () => {
    const quotation = draft();
    const refused = quotation.addLine(
      fixedLine({ pricing: { kind: 'fixed', amount: Money.ofMinor(100, 'USD') } }),
    );
    expect(refused.ok).toBe(false);
  });

  it('removes a line, and says so when there is none', () => {
    const quotation = draft();
    quotation.addLine(hoursLine());
    expect(quotation.removeLine('l-1').ok).toBe(true);
    expect(quotation.total().isZero()).toBe(true);
    expect(quotation.removeLine('l-1').ok).toBe(false);
  });
});

describe('sending', () => {
  it('sends a draft that has lines', () => {
    const quotation = draft();
    quotation.addLine(hoursLine());

    expect(quotation.send(now, 'by_hand').ok).toBe(true);
    expect(quotation.currentState).toBe('sent');
    expect(quotation.snapshot().sentAt).toEqual(now);
  });

  it('records what was offered, so the event carries the figure', () => {
    const quotation = draft();
    quotation.addLine(hoursLine());
    quotation.send(now, 'by_hand');

    const [event] = quotation.pullEvents();
    expect(event?.name).toBe('billing.quotation.sent');
    expect(event?.payload).toMatchObject({ totalMinor: 100_000, currency: 'AED' });
  });

  it('will not send an offer of nothing', () => {
    const refused = draft().send(now, 'by_hand');
    expect(refused.ok).toBe(false);
  });

  it('will not send one that has already expired', () => {
    const quotation = draft({ validUntil: later(-1) });
    quotation.addLine(hoursLine());
    const refused = quotation.send(now, 'by_hand');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('already expired');
  });

  it('will not send the same quotation twice', () => {
    const quotation = draft();
    quotation.addLine(hoursLine());
    quotation.send(now, 'by_hand');
    expect(quotation.send(now, 'by_hand').ok).toBe(false);
  });
});

describe('once it is with the client', () => {
  function sent() {
    const quotation = draft();
    quotation.addLine(hoursLine());
    quotation.send(now, 'by_hand');
    quotation.pullEvents();
    return quotation;
  }

  it('cannot be edited, only replaced', () => {
    const quotation = sent();
    // The document the client is holding and the one in here have to be the
    // same document.
    expect(quotation.addLine(fixedLine()).ok).toBe(false);
    expect(quotation.removeLine('l-1').ok).toBe(false);
  });

  it('is accepted, and says when', () => {
    const quotation = sent();
    expect(quotation.accept(later(2)).ok).toBe(true);
    expect(quotation.currentState).toBe('accepted');
    expect(quotation.snapshot().decidedAt).toEqual(later(2));
    expect(quotation.pullEvents()[0]?.name).toBe('billing.quotation.accepted');
  });

  it('is declined, and says when', () => {
    const quotation = sent();
    expect(quotation.decline(later(2)).ok).toBe(true);
    expect(quotation.currentState).toBe('declined');
    expect(quotation.pullEvents()[0]?.name).toBe('billing.quotation.declined');
  });

  it('cannot be answered twice', () => {
    const quotation = sent();
    quotation.accept(later(2));
    expect(quotation.decline(later(3)).ok).toBe(false);
  });

  it('cannot be answered before it was sent', () => {
    const quotation = draft();
    quotation.addLine(hoursLine());
    expect(quotation.accept(now).ok).toBe(false);
  });
});

describe('expiry', () => {
  function sent(validUntil: Date | null) {
    const quotation = draft({ validUntil: validUntil ?? null });
    quotation.addLine(hoursLine());
    quotation.send(now, 'by_hand');
    quotation.pullEvents();
    return quotation;
  }

  it('expires once the date has passed', () => {
    const quotation = sent(later(30));
    expect(quotation.expire(later(31)).ok).toBe(true);
    expect(quotation.currentState).toBe('expired');
  });

  it('does not expire early', () => {
    const quotation = sent(later(30));
    expect(quotation.expire(later(29)).ok).toBe(false);
  });

  it('never expires one with no date on it', () => {
    const quotation = sent(null);
    expect(quotation.expire(later(3650)).ok).toBe(false);
  });

  it('leaves an accepted quotation accepted, however old', () => {
    const quotation = sent(later(30));
    quotation.accept(later(2));
    // The client said yes. A sweep running later must not undo that.
    expect(quotation.expire(later(31)).ok).toBe(false);
    expect(quotation.currentState).toBe('accepted');
  });

  it('refuses to accept one that already expired, rather than honouring a lapsed price', () => {
    const quotation = sent(later(30));
    quotation.expire(later(31));
    expect(quotation.accept(later(32)).ok).toBe(false);
  });
});
