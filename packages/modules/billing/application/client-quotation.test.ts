import { describe, expect, it } from 'vitest';
import { ClientQuotation } from './client-quotation.js';
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
const later = (days: number) => new Date(now.getTime() + days * 86_400_000);

function harness(at = now) {
  const quotations = new InMemoryQuotations();
  const tokens = new CountingLinkTokens();
  const clock = new FakeClock(at);
  const manage = new ManageQuotations(
    quotations,
    new FakeRates(),
    clock,
    new CountingIds(),
    new CountingNumbers(192),
    new FakeDelivery(),
    tokens,
  );
  return {
    quotations,
    manage,
    tokens,
    clock,
    client: new ClientQuotation(quotations, tokens, clock, 'Active M Consultancy FZE LLC'),
  };
}

/** A quotation with a line on it, emailed — which is what issues the link. */
async function emailed(h: ReturnType<typeof harness>) {
  const made = await h.manage.draft('u-1', { clientId: 'c-1' });
  if (!made.ok) throw made.error;
  await h.manage.addLine(made.value.quotationId, {
    descriptionEn: 'VAT registration',
    descriptionAr: 'التسجيل الضريبي',
    amountMinor: 175_000,
  });
  const sent = await h.manage.send(made.value.quotationId, { deliver: true });
  if (!sent.ok) throw sent.error;
  return made.value.quotationId;
}

describe('the link a client opens', () => {
  it('shows them the offer, and records that they looked', async () => {
    const h = harness();
    const id = await emailed(h);

    const opened = await h.client.open('token-1');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.value.reference).toBe('192');
    expect(opened.value.total.minorUnits).toBe(175_000);
    expect(opened.value.answerable).toBe(true);

    // "Have they even looked at it" is the question asked before chasing
    // somebody a second time.
    expect((await h.quotations.findById(id))?.snapshot().linkOpenedAt).toEqual(now);
  });

  it('shows nothing about the firm beyond the offer itself', async () => {
    const h = harness();
    await emailed(h);

    const opened = await h.client.open('token-1');
    if (!opened.ok) throw opened.error;

    // This is the one view somebody outside the practice can reach.
    expect(Object.keys(opened.value).sort()).toEqual([
      'answerable',
      'currency',
      'firmName',
      'lines',
      'notesAr',
      'notesEn',
      'reference',
      'state',
      'total',
      'validUntil',
    ]);
  });

  it('records the first visit and not the second', async () => {
    const h = harness();
    const id = await emailed(h);

    await h.client.open('token-1');
    const first = (await h.quotations.findById(id))?.snapshot().linkOpenedAt;

    h.clock.set(later(3));
    await h.client.open('token-1');

    // Overwriting would lose the answer to the question being asked.
    expect((await h.quotations.findById(id))?.snapshot().linkOpenedAt).toEqual(first);
  });

  it('lets the client accept, and records that it was the client', async () => {
    const h = harness();
    const id = await emailed(h);

    const answered = await h.client.answer('token-1', 'accept');
    expect(answered.ok).toBe(true);
    if (answered.ok) expect(answered.value.answerable).toBe(false);

    const state = (await h.quotations.findById(id))?.snapshot();
    expect(state?.state).toBe('accepted');
    /*
     * The whole reason for the link. "The client accepted" and "an accountant
     * ticked accepted" are different evidence, and a record that cannot tell
     * them apart is no better than the phone call it replaces.
     */
    expect(state?.decidedBy).toBe('client');
  });

  it('lets the client decline', async () => {
    const h = harness();
    const id = await emailed(h);

    expect((await h.client.answer('token-1', 'decline')).ok).toBe(true);
    expect((await h.quotations.findById(id))?.snapshot().state).toBe('declined');
  });

  it('refuses a second answer, so nobody changes their mind unseen', async () => {
    const h = harness();
    await emailed(h);
    await h.client.answer('token-1', 'accept');

    const again = await h.client.answer('token-1', 'decline');
    expect(again.ok).toBe(false);
  });

  it('refuses a wrong token, an empty one, and one that has lapsed — alike', async () => {
    const h = harness();
    await emailed(h);

    const messages: string[] = [];
    for (const token of ['token-999', '', 'token-1']) {
      if (token === 'token-1') h.clock.set(later(61));
      const opened = await h.client.open(token);
      expect(opened.ok).toBe(false);
      if (!opened.ok) messages.push(opened.error.message);
    }

    // One refusal, three causes. Anything else tells somebody working through
    // guesses which of them they have found.
    expect(new Set(messages).size).toBe(1);
  });

  it('will not answer through a lapsed link', async () => {
    const h = harness();
    const id = await emailed(h);

    h.clock.set(later(61));
    expect((await h.client.answer('token-1', 'accept')).ok).toBe(false);
    expect((await h.quotations.findById(id))?.snapshot().state).toBe('sent');
  });

  it('revokes the previous link when the quotation is emailed again', async () => {
    const h = harness();
    const id = await emailed(h);

    // The case where the first went to the wrong address. The quotation is
    // already with the client, so this is a resend rather than a send.
    const again = await h.manage.sendAgain(id);
    expect(again.ok).toBe(true);

    expect((await h.client.open('token-1')).ok).toBe(false);
    expect((await h.client.open('token-2')).ok).toBe(true);
  });
});
