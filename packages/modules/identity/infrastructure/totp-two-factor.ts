import type { TwoFactorService } from '../application/ports.js';
import { SecretBox } from './secret-box.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

/** Binds the RFC 6238 implementation and the sealing of the secret together. */
export class TotpTwoFactorService implements TwoFactorService {
  constructor(
    private readonly box: SecretBox,
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

  seal(secretBase32: string): string {
    return this.box.seal(secretBase32);
  }

  open(sealed: string): string {
    return this.box.open(sealed);
  }
}
