import type { BranchView, FirmProfile } from '@amc/contracts';

/**
 * The firm's details as one printed document should carry them.
 *
 * The firm-wide profile is what every document used before branches existed,
 * and it is still what a document with no branch prints. A branch overrides the
 * parts it has filled in — its own addresses, its own bank account, its own
 * logo and stamp — and leaves the rest to the firm.
 *
 * The bank account is all or nothing, and deliberately so. An IBAN printed from
 * one place under an account holder from another is a payment to the wrong
 * account, and the table refuses half an account for the same reason.
 *
 * The legal name never changes: a branch is a letterhead of one legal entity,
 * with one tax registration, not a separate company.
 */
export function letterheadFor(profile: FirmProfile, branch: BranchView | null): FirmProfile {
  if (!branch) return profile;

  return {
    ...profile,
    addresses: branch.addresses.length > 0 ? branch.addresses : profile.addresses,
    bank: branch.bank
      ? { accountHolder: branch.bank.accountHolder, iban: branch.bank.iban, bic: branch.bank.bic }
      : profile.bank,
    logoUrl: branch.logoUrl ?? profile.logoUrl,
    stampUrl: branch.stampUrl ?? profile.stampUrl,
  };
}
