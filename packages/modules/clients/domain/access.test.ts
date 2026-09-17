import { describe, expect, it } from 'vitest';
import { scopeFor } from './access.js';

/** A caller who holds exactly these permissions and nothing else. */
const caller = (userId: string, permissions: string[]) => ({ userId, permissions });

/** The role table in SRS 2.2, expressed as what each role can see. */
describe('who sees which clients', () => {
  it('gives the manager everything', () => {
    expect(scopeFor(caller('user-1', ['clients.view.all', 'clients.edit']))).toEqual({
      kind: 'all',
    });
  });

  it('limits an accountant to the clients assigned to them', () => {
    expect(scopeFor(caller('user-2', ['clients.view.assigned']))).toEqual({
      kind: 'assigned',
      userId: 'user-2',
    });
  });

  it('gives data entry nothing', () => {
    // They upload invoices into batches they are given. A client file is not
    // their business.
    expect(scopeFor(caller('user-3', ['invoices.upload', 'invoices.correct']))).toEqual({
      kind: 'none',
    });
  });

  it('gives a portal client nothing through this route', () => {
    expect(scopeFor(caller('user-4', ['portal.self.view']))).toEqual({ kind: 'none' });
  });

  it('prefers the wider scope when someone holds both', () => {
    expect(scopeFor(caller('user-5', ['clients.view.assigned', 'clients.view.all']))).toEqual({
      kind: 'all',
    });
  });

  it('gives nothing for no permissions at all', () => {
    expect(scopeFor(caller('user-6', []))).toEqual({ kind: 'none' });
  });
});
