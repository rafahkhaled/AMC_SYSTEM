import type { EnvelopeCipher } from '@amc/vault';
import type { TwoFactorService } from '../application/ports.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

/**
 * Binds the RFC 6238 implementation to the shared vault cipher, so a
 * two-factor secret is protected exactly the way an EmaraTax credential is.
 *
 * It uses the cipher directly rather than the audited vault: verification
 * happens on every sign-in, and an audit entry per sign-in for reading the
 * secret would bury the entries that actually matter.
 */
export class TotpTwoFactorService implements TwoFactorService {
  constructor(
    private readonly cipher: EnvelopeCipher,
    private readonly issuer = 'AMC',
  ) {}

  newSecret(): string {
    return generateTotpSecret();
  }

  enrolmentUri(secretBase32: string, account: string): string {
    return totpUri({ secretBase32, account, issuer: this.issuer });
  }

  verify(secretBase32: string, code: string, at: Date): boolean {
    return verifyTotp(secretBase32, code, at.getTime());
  }

  seal(secretBase32: string): Promise<string> {
    return this.cipher.seal(secretBase32);
  }

  open(sealed: string): Promise<string> {
    return this.cipher.open(sealed);
  }
}
