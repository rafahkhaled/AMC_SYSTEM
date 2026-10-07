import { describe, expect, it } from 'vitest';
import { ManageQuotations } from './manage-quotations.js';
import {
  CountingIds,
  CountingLinkTokens,
  CountingNumbers,
  FakeClock,
  FakeDelivery,
  FakeRates,
  InMemoryQuotations,
} from './test-doubles.js';

const now = new Date('2026-09-22T08:00:00.000Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

/** The firm's own rate, as configuration supplies it. Five percent. */
const VAT = { vatBasisPoints: 500, paymentTermsDays: 14 };

function harness(at = now, delivery = new FakeDelivery()) {
  const quotations = new InMemoryQuotations();
  const manage = new ManageQuotations(
    quotations,
    new FakeRates(),
    new FakeClock(at),
    new CountingIds(),
    new CountingNumbers(192),
    delivery,
    new CountingLinkTokens(),
    VAT,
  );
  return { manage, quotations, delivery };
}

async function drafted(h: ReturnType<typeof harness>, reference = 'Q-2026-014') {
  const made = await h.manage.draft('u-1', {
    clientId: 'c-1',
    reference,
    validUntil: days(30),
  });
  if (!made.ok) throw made.error;
  return made.value.quotationId;
}

describe('drafting a quotation', () => {
  it('starts empty, in the client’s currency', async () => {
    const h = harness();
    const id = await drafted(h);

    const quotation = await h.quotations.findById(id);
    expect(quotation?.currentState).toBe('draft');
    expect(quotation?.snapshot().currency).toBe('AED');
    expect(quotation?.total().isZero()).toBe(true);
  });

  it('refuses a reference somebody is already using', async () => {
    const h = harness();
    await drafted(h, 'Q-2026-014');

    // The database would refuse it too, but halfway through a save and with a
    // constraint name. Somebody typing the number twice needs to be told it
    // is taken.
    const again = await h.manage.draft('u-1', { clientId: 'c-1', reference: 'Q-2026-014' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('already exists');
  });
});

describe('pricing a line', () => {
  it('takes hours and a rate, and multiplies them', async () => {
    const h = harness();
    const id = await drafted(h);

    const added = await h.manage.addLine(id, {
      descriptionEn: 'VAT registration',
      hours: 4,
      perHourMinor: 25_000,
      vat: 'out_of_scope',
    });
    expect(added.ok).toBe(true);
    expect((await h.quotations.findById(id))?.total().minorUnits).toBe(100_000);
  });

  it('takes a fixed amount', async () => {
    const h = harness();
    const id = await drafted(h);

    await h.manage.addLine(id, {
      descriptionAr: 'التدقيق السنوي',
      amountMinor: 500_000,
      vat: 'out_of_scope',
    });
    expect((await h.quotations.findById(id))?.total().minorUnits).toBe(500_000);
  });

  it('refuses a line priced both ways, or neither', async () => {
    const h = harness();
    const id = await drafted(h);

    const both = await h.manage.addLine(id, {
      descriptionEn: 'Work',
      hours: 4,
      perHourMinor: 25_000,
      amountMinor: 100_000,
      vat: 'out_of_scope',
    });
    expect(both.ok).toBe(false);

    const neither = await h.manage.addLine(id, { descriptionEn: 'Work', vat: 'out_of_scope' });
    expect(neither.ok).toBe(false);
  });

  it('removes a line', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });

    const quotation = await h.quotations.findById(id);
    const lineId = quotation?.snapshot().lines[0]?.id;
    if (!lineId) throw new Error('no line');

    expect((await h.manage.removeLine(id, lineId)).ok).toBe(true);
    expect((await h.quotations.findById(id))?.total().isZero()).toBe(true);
  });
});

describe('sending and answering', () => {
  async function sent() {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, {
      descriptionEn: 'Work',
      amountMinor: 500_000,
      vat: 'out_of_scope',
    });
    const out = await h.manage.send(id);
    if (!out.ok) throw out.error;
    return { h, id };
  }

  it('sends one that has lines', async () => {
    const { h, id } = await sent();
    expect((await h.quotations.findById(id))?.currentState).toBe('sent');
  });

  it('will not send an offer of nothing', async () => {
    const h = harness();
    const id = await drafted(h);
    expect((await h.manage.send(id)).ok).toBe(false);
  });

  it('cannot be edited once it is with the client', async () => {
    const { h, id } = await sent();
    const refused = await h.manage.addLine(id, {
      descriptionEn: 'More',
      amountMinor: 1000,
      vat: 'out_of_scope',
    });
    expect(refused.ok).toBe(false);
  });

  it('is accepted, or declined', async () => {
    const first = await sent();
    expect((await first.h.manage.accept(first.id)).ok).toBe(true);
    expect((await first.h.quotations.findById(first.id))?.currentState).toBe('accepted');

    const second = await sent();
    expect((await second.h.manage.decline(second.id)).ok).toBe(true);
    expect((await second.h.quotations.findById(second.id))?.currentState).toBe('declined');
  });

  it('says so when the quotation is not there', async () => {
    const h = harness();
    expect((await h.manage.send('nope')).ok).toBe(false);
    expect((await h.manage.accept('nope')).ok).toBe(false);
  });
});

describe('the expiry sweep', () => {
  it('expires what lapsed and leaves what has not', async () => {
    const h = harness();
    const soon = await drafted(h, 'Q-SOON');
    await h.manage.addLine(soon, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });
    await h.manage.send(soon);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
      new CountingNumbers(900),
      new FakeDelivery(),
      new CountingLinkTokens(),
      VAT,
    );
    const swept = await later.sweepExpired();

    expect(swept.expired).toBe(1);
    expect((await h.quotations.findById(soon))?.currentState).toBe('expired');
  });

  it('leaves an accepted quotation accepted, however old', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });
    await h.manage.send(id);
    await h.manage.accept(id);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
      new CountingNumbers(900),
      new FakeDelivery(),
      new CountingLinkTokens(),
      VAT,
    );
    // The client said yes. A sweep running later must not undo that.
    expect((await later.sweepExpired()).expired).toBe(0);
    expect((await h.quotations.findById(id))?.currentState).toBe('accepted');
  });

  it('refuses to accept one that already lapsed, rather than honouring the price', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });
    await h.manage.send(id);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
      new CountingNumbers(900),
      new FakeDelivery(),
      new CountingLinkTokens(),
      VAT,
    );
    await later.sweepExpired();
    expect((await later.accept(id)).ok).toBe(false);
  });
});

describe('getting it to the client', () => {
  it('records that somebody sent it by hand, and sends nothing', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });

    const sent = await h.manage.send(id);
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.value.via).toBe('by_hand');

    // Half of these are printed and handed over. That is a real answer, and
    // a different claim from "we emailed it".
    expect(h.delivery.sent).toHaveLength(0);
    expect((await h.quotations.findById(id))?.snapshot().sentVia).toBe('by_hand');
  });

  it('emails it when asked, and says so on the quotation', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });

    const sent = await h.manage.send(id, { deliver: true });
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.value.via).toBe('email');

    expect(h.delivery.sent).toEqual([
      { quotationId: id, reference: 'Q-2026-014', linkToken: 'token-1' },
    ]);
    expect((await h.quotations.findById(id))?.snapshot().sentVia).toBe('email');
  });

  it('refuses when the client has no address, rather than marking it sent', async () => {
    const h = harness(now, new FakeDelivery(null));
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000, vat: 'out_of_scope' });

    const sent = await h.manage.send(id, { deliver: true });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error.message).toContain('no email address');

    /*
     * Still a draft. Marking it sent because the mail could not go is how a
     * quotation ends up believed-delivered and never chased, which is the
     * exact failure this whole change exists to remove.
     */
    expect((await h.quotations.findById(id))?.currentState).toBe('draft');
  });

  it('does not deliver a quotation that cannot be sent anyway', async () => {
    const h = harness();
    const id = await drafted(h);

    // No lines: not an offer, and the aggregate refuses it. Nothing should
    // have reached the client's inbox on the way to finding that out.
    const sent = await h.manage.send(id, { deliver: true });
    expect(sent.ok).toBe(false);
    expect(h.delivery.sent).toHaveLength(0);
  });
});

/*
 * The firm's rate, not the screen's (feedback item 13).
 *
 * The browser sends "standard" or "out of scope" and the rate behind the
 * first comes from configuration here. If the screen sent a number instead,
 * a quotation could be offered at a rate the firm does not charge — and the
 * invoice that followed it would say something else.
 */
describe('VAT and discounts on a line', () => {
  async function lineOn(
    h: ReturnType<typeof harness>,
    command: Parameters<typeof h.manage.addLine>[1],
  ) {
    const id = await drafted(h);
    const added = await h.manage.addLine(id, command);
    if (!added.ok) throw added.error;
    const quotation = await h.quotations.findById(id);
    if (!quotation) throw new Error('no quotation');
    return quotation;
  }

  it('stamps the configured rate on a standard-rated line', async () => {
    const quotation = await lineOn(harness(), {
      descriptionEn: 'VAT return',
      amountMinor: 100_000,
      vat: 'standard',
    });

    expect(quotation.snapshot().lines[0]?.vatBasisPoints).toBe(500);
    expect(quotation.total().minorUnits).toBe(105_000);
  });

  it('leaves an out-of-scope line with no rate at all', async () => {
    // Null rather than zero: a line at zero percent is a taxable supply
    // charged at nothing, and these sit in different boxes on the return.
    const quotation = await lineOn(harness(), {
      descriptionEn: 'Authority fee',
      amountMinor: 100_000,
      vat: 'out_of_scope',
    });

    expect(quotation.snapshot().lines[0]?.vatBasisPoints).toBeNull();
    expect(quotation.total().minorUnits).toBe(100_000);
  });

  it('takes the discount off before charging VAT on what is left', async () => {
    const quotation = await lineOn(harness(), {
      descriptionEn: 'Annual audit',
      amountMinor: 500_000,
      discountMinor: 50_000,
      vat: 'standard',
    });

    expect(quotation.net().minorUnits).toBe(450_000);
    expect(quotation.vatTotal().minorUnits).toBe(22_500);
    expect(quotation.total().minorUnits).toBe(472_500);
  });

  it('keeps which service the line was for', async () => {
    const quotation = await lineOn(harness(), {
      serviceCode: 'vat_return',
      descriptionEn: 'VAT return, Q3',
      amountMinor: 100_000,
      vat: 'standard',
    });

    expect(quotation.snapshot().lines[0]?.serviceCode).toBe('vat_return');
  });

  it('refuses a discount larger than the line, through this layer too', async () => {
    const h = harness();
    const id = await drafted(h);
    const refused = await h.manage.addLine(id, {
      descriptionEn: 'Work',
      amountMinor: 1000,
      discountMinor: 1001,
      vat: 'standard',
    });
    expect(refused.ok).toBe(false);
  });
});
