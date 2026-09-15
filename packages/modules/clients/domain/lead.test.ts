import { describe, expect, it } from 'vitest';
import { Lead } from './lead.js';

const at = (iso: string) => new Date(iso);

function lead(overrides: Partial<Parameters<typeof Lead.capture>[0]> = {}) {
  const created = Lead.capture({
    id: 'lead-1',
    name: 'Ahmed Al Marzooqi',
    phone: '+971 50 123 4567',
    source: 'whatsapp',
    sourceDetail: 'Instagram advertisement, March',
    requestedService: 'VAT registration',
    now: at('2026-03-01T06:00:00Z'),
    ...overrides,
  });
  if (!created.ok) throw new Error('fixture');
  created.value.pullEvents();
  return created.value;
}

describe('capturing an enquiry (FR-01)', () => {
  it('records where it came from, in detail', () => {
    expect(lead().snapshot().sourceDetail).toBe('Instagram advertisement, March');
  });

  it('insists on a way to reach the person', () => {
    // An enquiry nobody can follow up is not a lead.
    const unreachable = Lead.capture({
      id: 'lead-2',
      name: 'Anonymous',
      source: 'walk_in',
      now: at('2026-03-01T06:00:00Z'),
    });
    expect(unreachable.ok).toBe(false);
  });

  it('accepts an email instead of a phone number', () => {
    expect(lead({ phone: null, email: 'ahmed@example.ae' }).snapshot().email).toBe(
      'ahmed@example.ae',
    );
  });

  it('refuses an enquiry with no name', () => {
    expect(
      Lead.capture({
        id: 'l',
        name: '  ',
        phone: '050',
        source: 'phone',
        now: at('2026-03-01T06:00:00Z'),
      }).ok,
    ).toBe(false);
  });

  it('starts as new', () => {
    expect(lead().status).toBe('new');
  });
});

describe('how an enquiry progresses', () => {
  it('follows the expected path', () => {
    const subject = lead();
    expect(subject.moveTo('contacted', at('2026-03-02T06:00:00Z')).ok).toBe(true);
    expect(subject.moveTo('quoted', at('2026-03-03T06:00:00Z')).ok).toBe(true);
    expect(subject.moveTo('confirmed', at('2026-03-05T06:00:00Z')).ok).toBe(true);
  });

  it('will not let a new enquiry jump straight to confirmed', () => {
    // Otherwise a client appears that nobody has spoken to or quoted.
    expect(lead().moveTo('confirmed', at('2026-03-02T06:00:00Z')).ok).toBe(false);
  });

  it('lets a quoted enquiry go back to contacted, because people reopen conversations', () => {
    const subject = lead();
    subject.moveTo('contacted', at('2026-03-02T06:00:00Z'));
    subject.moveTo('quoted', at('2026-03-03T06:00:00Z'));
    expect(subject.moveTo('contacted', at('2026-03-10T06:00:00Z')).ok).toBe(true);
  });

  it('treats declined as final', () => {
    const subject = lead();
    subject.moveTo('declined', at('2026-03-02T06:00:00Z'));
    expect(subject.moveTo('contacted', at('2026-03-03T06:00:00Z')).ok).toBe(false);
  });

  it('says what it refused and why', () => {
    const outcome = lead().moveTo('confirmed', at('2026-03-02T06:00:00Z'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain('from new to confirmed');
  });
});

describe('becoming a client', () => {
  it('links both ways and keeps the source', () => {
    const subject = lead();
    subject.moveTo('contacted', at('2026-03-02T06:00:00Z'));
    expect(subject.convertTo('client-1', at('2026-03-05T06:00:00Z')).ok).toBe(true);

    expect(subject.status).toBe('confirmed');
    expect(subject.convertedClientId).toBe('client-1');

    // A year later, "where did this client come from?" still has an answer.
    const event = subject.pullEvents().find((e) => e.name === 'clients.lead.converted');
    expect(event?.payload).toMatchObject({ clientId: 'client-1', source: 'whatsapp' });
  });

  it('refuses to convert the same enquiry twice', () => {
    const subject = lead();
    subject.convertTo('client-1', at('2026-03-05T06:00:00Z'));
    expect(subject.convertTo('client-2', at('2026-03-06T06:00:00Z')).ok).toBe(false);
  });

  it('refuses to convert an enquiry that was declined', () => {
    const subject = lead();
    subject.moveTo('declined', at('2026-03-02T06:00:00Z'));
    expect(subject.convertTo('client-1', at('2026-03-05T06:00:00Z')).ok).toBe(false);
  });
});
