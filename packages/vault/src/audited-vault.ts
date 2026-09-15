import type { Actor } from '@amc/kernel';
import type { EnvelopeCipher } from './envelope-cipher.js';

export interface SecretAccess {
  readonly actor: Actor;
  /** What the secret belongs to: a client, a supplier, an integration. */
  readonly entityType: string;
  readonly entityId: string;
  /** Which secret, for the log. Never the secret itself. */
  readonly label: string;
  /** Why it was opened. Shown to whoever reads the log later. */
  readonly reason?: string | undefined;
}

/**
 * Records that a secret was read. Implemented by the audit module, declared
 * here, so the vault never depends on audit and audit never depends on the
 * vault.
 */
export interface SecretAccessRecorder {
  record(access: SecretAccess): Promise<void>;
}

/**
 * The EmaraTax credential vault (FR-05, NFR-04/05).
 *
 * Reading is only possible through a method that records the reading. There is
 * no way to get a credential out of here quietly, because the recording is not
 * a step a caller performs afterwards and might forget: it is part of the only
 * route in.
 *
 * The recording happens before the plaintext is returned. If the log cannot be
 * written the secret is not handed over, which is the right way round for a
 * system whose audit trail is a requirement rather than a convenience.
 */
export class AuditedVault {
  constructor(
    private readonly cipher: EnvelopeCipher,
    private readonly recorder: SecretAccessRecorder,
  ) {}

  async seal(plaintext: string): Promise<string> {
    return this.cipher.seal(plaintext);
  }

  async open(sealed: string, access: SecretAccess): Promise<string> {
    await this.recorder.record(access);
    return this.cipher.open(sealed);
  }

  /**
   * Answers "is this the stored value?" without revealing it. Checking a
   * credential still counts as using it, so it is recorded too.
   */
  async matches(sealed: string, candidate: string, access: SecretAccess): Promise<boolean> {
    await this.recorder.record({ ...access, reason: access.reason ?? 'comparison' });
    return this.cipher.holdsSame(sealed, candidate);
  }
}
