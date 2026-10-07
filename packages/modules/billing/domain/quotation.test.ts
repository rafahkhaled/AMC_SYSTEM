import { Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Quotation, type QuotationLine, quotedPrice } from './quotation.js';

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
  serviceCode: 'vat_registration',
  descriptionEn: 'VAT registration',
  descriptionAr: 'التسجيل الضريبي',
  pricing: { kind: 'hours', hours: 4, perHour: aed(25_000) },
  discount: aed(0),
  vatBasisPoints: null,
  ...over,
});

const fixedLine = (over: Partial<QuotationLine> = {}): QuotationLine => ({
  id: 'l-2',
  serviceCode: 'audit',
  descriptionEn: 'Annual audit',
  descriptionAr: 'التدقيق السنوي',
  pricing: { kind: 'fixed', amount: aed(500_000) },
  discount: aed(0),
  vatBasisPoints: null,
  ...over,
});

describe('what a line comes to', () => {
  it('multiplies an hourly estimate by the rate', () => {
    expect(quotedPrice({ kind: 'hours', hours: 4, perHour: aed(25_000) }).minorUnits).toBe(100_000);
  });

  it('handles a half hour without floating point', () => {
    // 3.5 hours at 123.45 is 432.075, which has to round one way by one rule
    // rather than however a float landed.
    const total = quotedPrice({ kind: 'hours', hours: 3.5, perHour: aed(12_345) });
    expect(total.minorUnits).toBe(43_208);
  });

  it('takes a fixed amount as it is', () => {
    expect(quotedPrice({ kind: 'fixed', amount: aed(500_000) }).minorUnits).toBe(500_000);
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

/*
 * What the client is actually charged (feedback item 13).
 *
 * A line now carries a discount and a VAT rate, so the total the client sees
 * is no longer the sum of the prices. Each part is asserted on separately
 * because each one is a question somebody asks later: what we quoted, what we
 * allowed off, what VAT applied, and what they owed in the end.
 */
describe('discounts and VAT on a line', () => {
  it('charges VAT on what is left after the discount, not on the price', () => {
    const quotation = draft();
    // 5,000 quoted, 500 allowed off, five percent on the 4,500 that remains.
    quotation.addLine(fixedLine({ discount: aed(50_000), vatBasisPoints: 500 }));

    expect(quotation.subtotal().minorUnits).toBe(500_000);
    expect(quotation.discountTotal().minorUnits).toBe(50_000);
    expect(quotation.net().minorUnits).toBe(450_000);
    expect(quotation.vatTotal().minorUnits).toBe(22_500);
    expect(quotation.total().minorUnits).toBe(472_500);
  });

  it('charges nothing on a line that is out of scope', () => {
    const quotation = draft();
    quotation.addLine(fixedLine({ vatBasisPoints: null }));

    expect(quotation.vatTotal().isZero()).toBe(true);
    expect(quotation.total().minorUnits).toBe(500_000);
  });

  it('keeps out of scope apart from zero percent, which is a different claim', () => {
    // Both charge nothing. They sit in different boxes on the return, so the
    // line has to remember which one it was rather than collapsing to 0.
    const quotation = draft();
    quotation.addLine(fixedLine({ vatBasisPoints: 0 }));
    expect(quotation.snapshot().lines[0]?.vatBasisPoints).toBe(0);

    const other = draft();
    other.addLine(fixedLine({ vatBasisPoints: null }));
    expect(other.snapshot().lines[0]?.vatBasisPoints).toBeNull();
  });

  it('rounds VAT line by line, so the column the client adds up is the total', () => {
    /*
     * Five percent of 10.05 is 0.5025, which rounds down to half a fils
     * nobody charges. Taken on the total of three such lines it is 1.5075 and
     * rounds up to 151 fils; taken per line it is 50 three times, which is
     * 150. The client adds the column up, so the document agrees with the
     * column rather than with the shorter calculation.
     */
    const quotation = draft();
    for (const id of ['a', 'b', 'c']) {
      quotation.addLine(
        fixedLine({ id, pricing: { kind: 'fixed', amount: aed(1_005) }, vatBasisPoints: 500 }),
      );
    }
    expect(quotation.vatTotal().minorUnits).toBe(150);
    expect(quotation.total().minorUnits).toBe(3_165);
  });

  it('refuses a discount bigger than the line it comes off', () => {
    // Otherwise the line charges less than nothing and the client receives
    // something that reads as a credit note for work that never happened.
    const quotation = draft();
    const refused = quotation.addLine(fixedLine({ discount: aed(500_001) }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('more than the line');
  });

  it('allows a discount of the whole line, which is work given away', () => {
    const quotation = draft();
    expect(quotation.addLine(fixedLine({ discount: aed(500_000), vatBasisPoints: 500 })).ok).toBe(
      true,
    );
    expect(quotation.total().isZero()).toBe(true);
  });

  it('refuses a negative discount, which is a surcharge wearing the wrong name', () => {
    expect(draft().addLine(fixedLine({ discount: aed(-100) })).ok).toBe(false);
  });

  it('refuses a rate that is not a rate', () => {
    expect(draft().addLine(fixedLine({ vatBasisPoints: 10_001 })).ok).toBe(false);
    expect(draft().addLine(fixedLine({ vatBasisPoints: -1 })).ok).toBe(false);
  });

  it('discounts an hourly line against what the hours came to', () => {
    // 4 hours at 250 is 1,000, less 100, plus five percent of 900.
    const quotation = draft();
    quotation.addLine(hoursLine({ discount: aed(10_000), vatBasisPoints: 500 }));

    expect(quotation.net().minorUnits).toBe(90_000);
    expect(quotation.total().minorUnits).toBe(94_500);
  });

  it('adds the lines up one way, whatever VAT each of them carries', () => {
    // One document routinely carries both: a return at five percent and a
    // government fee that is outside the scope of VAT entirely.
    const quotation = draft();
    quotation.addLine(fixedLine({ id: 'taxable', vatBasisPoints: 500 }));
    quotation.addLine(
      fixedLine({
        id: 'fee',
        pricing: { kind: 'fixed', amount: aed(100_000) },
        vatBasisPoints: null,
      }),
    );

    expect(quotation.net().minorUnits).toBe(600_000);
    expect(quotation.vatTotal().minorUnits).toBe(25_000);
    expect(quotation.total().minorUnits).toBe(625_000);
  });

  it('tells the client the chargeable total, which is what the event reports', () => {
    const quotation = draft();
    quotation.addLine(fixedLine({ discount: aed(50_000), vatBasisPoints: 500 }));
    quotation.pullEvents();

    quotation.send(now, 'email');
    const [event] = quotation.pullEvents();

    expect(event?.payload).toMatchObject({
      netMinor: 450_000,
      vatMinor: 22_500,
      discountMinor: 50_000,
      totalMinor: 472_500,
    });
  });

  it('keeps the service the line was for, so a project can be opened for it', () => {
    const quotation = draft();
    quotation.addLine(fixedLine({ serviceCode: 'vat_return' }));
    expect(quotation.snapshot().lines[0]?.serviceCode).toBe('vat_return');
  });

  it('takes a line that is not a service at all', () => {
    // An authority fee or a disbursement. Forcing every line to name one of
    // the eleven would mean inventing a service that does not exist.
    const quotation = draft();
    expect(quotation.addLine(fixedLine({ serviceCode: null })).ok).toBe(true);
  });
});
