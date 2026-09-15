import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from './errors.js';
import { signInRequestSchema, signInResponseSchema } from './identity.js';

/**
 * These schemas are the agreement between the API and the browser. Testing them
 * here means a change that would break one side is caught before either side
 * compiles against it.
 */
describe('sign-in request', () => {
  it('accepts a normal submission and trims the address', () => {
    const parsed = signInRequestSchema.safeParse({
      email: '  wael@activemanagement.ae ',
      password: 'correct horse battery staple',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe('wael@activemanagement.ae');
  });

  it('rejects an empty submission', () => {
    expect(signInRequestSchema.safeParse({ email: '', password: '' }).success).toBe(false);
  });

  it('puts a ceiling on both fields, so nothing unbounded reaches the hasher', () => {
    expect(
      signInRequestSchema.safeParse({ email: 'a@b.com', password: 'x'.repeat(257) }).success,
    ).toBe(false);
    expect(
      signInRequestSchema.safeParse({ email: `${'a'.repeat(250)}@b.com`, password: 'x' }).success,
    ).toBe(false);
  });

  it('does not judge the shape of a password at sign-in', () => {
    // Rules belong to registration. Enforcing them here would hint at what the
    // stored password looks like.
    expect(signInRequestSchema.safeParse({ email: 'a@b.com', password: '1' }).success).toBe(true);
  });
});

describe('sign-in response', () => {
  it('describes the caller and when the session lapses', () => {
    const parsed = signInResponseSchema.safeParse({
      caller: {
        userId: '01M2JB5PW51DZWXXS82CD740JD',
        displayName: 'Wael Ajam',
        roles: ['manager'],
        permissions: ['users.manage'],
      },
      expiresAt: '2026-09-15T11:20:51.967Z',
      twoFactorRequired: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a role the system does not have', () => {
    const parsed = signInResponseSchema.safeParse({
      caller: { userId: 'u', displayName: 'n', roles: ['superuser'], permissions: [] },
      expiresAt: '2026-09-15T11:20:51.967Z',
      twoFactorRequired: false,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('error envelope', () => {
  it('is the one shape the browser has to understand', () => {
    const parsed = errorEnvelopeSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'No such client', requestId: 'abc' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.error.details).toEqual({});
  });
});
