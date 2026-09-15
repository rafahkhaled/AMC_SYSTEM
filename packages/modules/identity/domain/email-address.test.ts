import { describe, expect, it } from 'vitest';
import { EmailAddress } from './email-address.js';

describe('EmailAddress', () => {
  it('lowercases and trims, so one inbox is one account', () => {
    const address = EmailAddress.of('  Wael@ActiveManagement.AE  ');
    expect(address.ok && address.value.value).toBe('wael@activemanagement.ae');
  });

  it('accepts the shapes real addresses take', () => {
    for (const raw of ['a.b+tag@example.co.uk', "o'brien@firm.ae", 'x_y-z@sub.domain.com']) {
      expect(EmailAddress.of(raw).ok).toBe(true);
    }
  });

  it('rejects what is clearly not an address', () => {
    for (const raw of ['', '   ', 'no-at-sign', 'two@@at.com', 'trailing@dot', 'spaces in@x.com']) {
      expect(EmailAddress.of(raw).ok).toBe(false);
    }
  });

  it('exposes the domain', () => {
    const address = EmailAddress.of('wael@activemanagement.ae');
    expect(address.ok && address.value.domain).toBe('activemanagement.ae');
  });
});
