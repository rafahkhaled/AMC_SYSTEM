import { describe, expect, it } from 'vitest';
import { scopeFor } from './access.js';

/** The role table in SRS 2.2, expressed as what each role can see. */
describe('who sees which clients', () => {
  it('gives the manager everything', () => {
    expect(scopeFor(['clients.view.all', 'clients.edit'], 'user-1')).toEqual({ kind: 'all' });
  });

  it('limits an accountant to the clients assigned to them', () => {
    expect(scopeFor(['clients.view.assigned'], 'user-2')).toEqual({
      kind: 'assigned',
      userId: 'user-2',
    });
  });

  it('gives data entry nothing', () => {
    // They upload invoices into batches they are given. A client file is not
    // their business.
    expect(scopeFor(['invoices.upload', 'invoices.correct'], 'user-3')).toEqual({ kind: 'none' });
  });

  it('gives a portal client nothing through this route', () => {
    expect(scopeFor(['portal.self.view'], 'user-4')).toEqual({ kind: 'none' });
  });

  it('prefers the wider scope when someone holds both', () => {
    expect(scopeFor(['clients.view.assigned', 'clients.view.all'], 'user-5')).toEqual({
      kind: 'all',
    });
  });

  it('gives nothing for no permissions at all', () => {
    expect(scopeFor([], 'user-6')).toEqual({ kind: 'none' });
  });
});
