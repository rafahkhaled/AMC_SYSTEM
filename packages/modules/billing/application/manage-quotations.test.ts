import { describe, expect, it } from 'vitest';
import { ManageQuotations } from './manage-quotations.js';
import { CountingIds, FakeClock, FakeRates, InMemoryQuotations } from './test-doubles.js';

const now = new Date('2026-09-22T08:00:00.000Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

function harness(at = now) {
  const quotations = new InMemoryQuotations();
  const manage = new ManageQuotations(
    quotations,
    new FakeRates(),
    new FakeClock(at),
    new CountingIds(),
  );
  return { manage, quotations };
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
    });
    expect(added.ok).toBe(true);
    expect((await h.quotations.findById(id))?.total().minorUnits).toBe(100_000);
  });

  it('takes a fixed amount', async () => {
    const h = harness();
    const id = await drafted(h);

    await h.manage.addLine(id, { descriptionAr: 'التدقيق السنوي', amountMinor: 500_000 });
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
    });
    expect(both.ok).toBe(false);

    const neither = await h.manage.addLine(id, { descriptionEn: 'Work' });
    expect(neither.ok).toBe(false);
  });

  it('removes a line', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000 });

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
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 500_000 });
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
    const refused = await h.manage.addLine(id, { descriptionEn: 'More', amountMinor: 1000 });
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
    await h.manage.addLine(soon, { descriptionEn: 'Work', amountMinor: 1000 });
    await h.manage.send(soon);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
    );
    const swept = await later.sweepExpired();

    expect(swept.expired).toBe(1);
    expect((await h.quotations.findById(soon))?.currentState).toBe('expired');
  });

  it('leaves an accepted quotation accepted, however old', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000 });
    await h.manage.send(id);
    await h.manage.accept(id);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
    );
    // The client said yes. A sweep running later must not undo that.
    expect((await later.sweepExpired()).expired).toBe(0);
    expect((await h.quotations.findById(id))?.currentState).toBe('accepted');
  });

  it('refuses to accept one that already lapsed, rather than honouring the price', async () => {
    const h = harness();
    const id = await drafted(h);
    await h.manage.addLine(id, { descriptionEn: 'Work', amountMinor: 1000 });
    await h.manage.send(id);

    const later = new ManageQuotations(
      h.quotations,
      new FakeRates(),
      new FakeClock(days(40)),
      new CountingIds(),
    );
    await later.sweepExpired();
    expect((await later.accept(id)).ok).toBe(false);
  });
});
