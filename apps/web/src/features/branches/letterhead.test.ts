import type { BranchView, FirmProfile } from '@amc/contracts';
import { describe, expect, it } from 'vitest';
import { letterheadFor } from './letterhead.js';

const firm: FirmProfile = {
  legalName: 'Active M Consultancy FZE LLC',
  addresses: ['Dubai: an office', 'Ajman: another office'],
  bank: { accountHolder: 'Active M Consultancy FZE LLC', iban: 'AE-FIRM', bic: 'FIRMAEAA' },
  logoUrl: 'https://example.test/firm-logo.png',
  stampUrl: 'https://example.test/firm-stamp.png',
  vatBasisPoints: 500,
};

const branch = (over: Partial<BranchView> = {}): BranchView => ({
  code: 'ajman',
  nameEn: 'Ajman Branch',
  nameAr: 'فرع عجمان',
  addresses: [],
  bank: null,
  logoUrl: null,
  stampUrl: null,
  retired: false,
  ...over,
});

describe('the letterhead a document prints on', () => {
  it('is the firm’s own when there is no branch, as every document used to be', () => {
    expect(letterheadFor(firm, null)).toBe(firm);
  });

  it('keeps the firm’s details for whatever a branch has not filled in', () => {
    // A branch just created has no addresses yet, and a blank footer would be
    // worse than the one the document had before.
    expect(letterheadFor(firm, branch())).toEqual(firm);
  });

  it('takes the branch’s addresses in place of both of the firm’s', () => {
    const printed = letterheadFor(firm, branch({ addresses: ['Ajman: Free Zone, Office 12'] }));
    expect(printed.addresses).toEqual(['Ajman: Free Zone, Office 12']);
  });

  it('takes the branch’s bank account whole, never mixed with the firm’s', () => {
    const printed = letterheadFor(
      firm,
      branch({ bank: { accountHolder: 'Active M - Ajman', iban: 'AE-AJMAN', bic: null } }),
    );
    // Not the branch's IBAN under the firm's holder, or the firm's BIC under
    // the branch's IBAN: that is a payment to the wrong account.
    expect(printed.bank).toEqual({
      accountHolder: 'Active M - Ajman',
      iban: 'AE-AJMAN',
      bic: null,
    });
  });

  it('takes the branch’s logo and stamp where it has them, and the firm’s where it has not', () => {
    const printed = letterheadFor(firm, branch({ logoUrl: 'https://example.test/ajman.png' }));
    expect(printed.logoUrl).toBe('https://example.test/ajman.png');
    expect(printed.stampUrl).toBe('https://example.test/firm-stamp.png');
  });

  it('never changes who is issuing it', () => {
    // A branch is a letterhead of one legal entity, with one tax registration.
    const printed = letterheadFor(firm, branch({ addresses: ['x'] }));
    expect(printed.legalName).toBe('Active M Consultancy FZE LLC');
    expect(printed.vatBasisPoints).toBe(500);
  });
});
