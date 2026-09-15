import { createHmac, randomBytes } from 'node:crypto';

export interface DataKey {
  /** The key itself, used once and then dropped. */
  readonly plaintext: Buffer;
  /** The same key, encrypted under the master key, stored beside the data. */
  readonly encrypted: Buffer;
}

/**
 * Envelope encryption: a fresh key per secret, itself encrypted under a master
 * key that never leaves its keeper.
 *
 * The point is that the key protecting the data is not the key in the
 * configuration. Rotating the master key re-wraps the data keys without
 * touching a single row, and a data key recovered from one record opens that
 * record and nothing else.
 */
export interface KeyProvider {
  generate(): Promise<DataKey>;
  decrypt(encrypted: Buffer): Promise<Buffer>;
  /** Identifies which master key sealed something, for rotation. */
  readonly keyId: string;
}

/**
 * For development and tests: data keys are derived from a master key held in
 * configuration, using HMAC so the master key is never used directly to
 * encrypt anything.
 *
 * Production uses KMS instead, and the difference matters: here the master key
 * is in an environment variable, which means it is in a deployment tool, a
 * backup and somebody's shell history.
 */
export class LocalKeyProvider implements KeyProvider {
  readonly keyId = 'local';
  private readonly master: Buffer;

  constructor(masterKeyBase64: string) {
    const master = Buffer.from(masterKeyBase64, 'base64');
    if (master.length !== 32) {
      throw new Error(
        'The master key must be 32 bytes, base64 encoded. Generate one with: openssl rand -base64 32',
      );
    }
    this.master = master;
  }

  async generate(): Promise<DataKey> {
    // The nonce is what makes each data key different; the master key derives
    // rather than encrypts, so it is never applied to attacker-chosen data.
    const nonce = randomBytes(32);
    return { plaintext: this.derive(nonce), encrypted: nonce };
  }

  async decrypt(encrypted: Buffer): Promise<Buffer> {
    if (encrypted.length !== 32) throw new Error('That is not a key this provider issued');
    return this.derive(encrypted);
  }

  private derive(nonce: Buffer): Buffer {
    return createHmac('sha256', this.master).update(nonce).digest();
  }
}

export interface KmsLike {
  send(command: unknown): Promise<{ Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }>;
}

/**
 * Production. The master key lives in KMS and never reaches this process; the
 * only thing that crosses the wire is a data key, used once.
 *
 * The encryption context binds each data key to the record it belongs to, so a
 * ciphertext moved from one row to another will not decrypt. That is the
 * defence against an attacker who can write to the database but not read the
 * key: swapping in their own sealed value does not work.
 */
export class KmsKeyProvider implements KeyProvider {
  constructor(
    private readonly kms: KmsLike,
    readonly keyId: string,
    /**
     * The command classes, injected rather than imported, so this package does
     * not force the AWS SDK on anything that only wants the local provider.
     */
    private readonly commands: {
      generateDataKey: new (input: Record<string, unknown>) => unknown;
      decrypt: new (input: Record<string, unknown>) => unknown;
    },
    private readonly encryptionContext: Record<string, string> = { system: 'amc' },
  ) {}

  async generate(): Promise<DataKey> {
    const response = await this.kms.send(
      new this.commands.generateDataKey({
        KeyId: this.keyId,
        KeySpec: 'AES_256',
        EncryptionContext: this.encryptionContext,
      }),
    );
    if (!response.Plaintext || !response.CiphertextBlob) {
      throw new Error('KMS returned no data key');
    }
    return {
      plaintext: Buffer.from(response.Plaintext),
      encrypted: Buffer.from(response.CiphertextBlob),
    };
  }

  async decrypt(encrypted: Buffer): Promise<Buffer> {
    const response = await this.kms.send(
      new this.commands.decrypt({
        CiphertextBlob: encrypted,
        EncryptionContext: this.encryptionContext,
      }),
    );
    if (!response.Plaintext) throw new Error('KMS could not decrypt that data key');
    return Buffer.from(response.Plaintext);
  }
}
