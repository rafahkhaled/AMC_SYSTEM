import { describe, expect, it } from 'vitest';
import { mayWrite, scopeFor } from './access.js';

const caller = (permissions: string[]) => ({ userId: 'u-1', permissions: new Set(permissions) });

describe('who may see which conversations', () => {
  it('gives a manager everything', () => {
    expect(scopeFor(caller(['clients.view.all']))).toEqual({ kind: 'all' });
  });

  it('gives an accountant their own clients', () => {
    expect(scopeFor(caller(['clients.view.assigned']))).toEqual({
      kind: 'assigned',
      userId: 'u-1',
    });
  });

  it('gives data entry nothing', () => {
    expect(scopeFor(caller(['invoices.upload']))).toEqual({ kind: 'none' });
  });

  it('prefers the wider permission when somebody holds both', () => {
    expect(scopeFor(caller(['clients.view.assigned', 'clients.view.all']))).toEqual({
      kind: 'all',
    });
  });
});

describe('who may write to a client', () => {
  it('is whoever may edit a client', () => {
    expect(mayWrite(caller(['clients.edit']))).toBe(true);
    expect(mayWrite(caller(['clients.view.all']))).toBe(false);
  });
});
