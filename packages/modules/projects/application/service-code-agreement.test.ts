import { serviceCodes } from '@amc/contracts';
import { describe, expect, it } from 'vitest';
import { SERVICE_TEMPLATES, isServiceCode } from '../domain/index.js';

/**
 * The domain's services and the contract's list say the same thing.
 *
 * They are declared twice on purpose: the domain may not import contracts —
 * it sees the kernel and itself and nothing else — and a screen needs the
 * list to offer it in a dropdown. Two declarations drift, so this fails the
 * moment they do, which is the same bargain the phone-number SQL makes with
 * its TypeScript twin.
 */
describe('the services the firm offers', () => {
  it('are the same eleven on both sides', () => {
    expect([...serviceCodes].sort()).toEqual(Object.keys(SERVICE_TEMPLATES).sort());
  });

  it('every one of them is recognised at the edge', () => {
    // A service code arrives from outside in a request body, where the
    // compile-time union proves nothing.
    for (const code of serviceCodes) expect(isServiceCode(code)).toBe(true);
    expect(isServiceCode('vat_retrun')).toBe(false);
  });
});
