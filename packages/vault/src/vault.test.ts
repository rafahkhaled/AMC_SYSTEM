import { randomBytes } from 'node:crypto';
import type { Actor } from '@amc/kernel';
import { describe, expect, it, vi } from 'vitest';
import { AuditedVault, type SecretAccess, type SecretAccessRecorder } from './audited-vault.js';
import { EnvelopeCipher } from './envelope-cipher.js';
import { KmsKeyProvider, LocalKeyProvider } from './key-provider.js';

const masterKey = randomBytes(32).toString('base64');
const cipher = () => new EnvelopeCipher(new LocalKeyProvider(masterKey));

const ACTOR: Actor = { userId: 'user-1', roles: ['manager'], label: 'Wael Ajam' };
const ACCESS: SecretAccess = {
  actor: ACTOR,
  entityType: 'client',
  entityId: 'client-1',
  label: 'emaratax.password',
  reason: 'filing the quarterly return',
};

describe('envelope encryption', () => {
  it('returns what it was given', async () => {
    const box = cipher();
    expect(await box.open(await box.seal('EmaraTax!2026'))).toBe('EmaraTax!2026');
  });

  it('uses a different key for every secret, so two identical ones do not look alike', async () => {
    const box = cipher();
    const first = await box.seal('same password');
    const second = await box.seal('same password');

    expect(first).not.toBe(second);
    // Different wrapped keys, not merely a different nonce for one key.
    expect(first.split('.')[2]).not.toBe(second.split('.')[2]);
  });

  it('keeps the plaintext out of the stored value', async () => {
    expect(await cipher().seal('EmaraTax!2026')).not.toContain('EmaraTax');
  });

  it('refuses a tampered value rather than returning something plausible', async () => {
    const box = cipher();
    const parts = (await box.seal('EmaraTax!2026')).split('.');
    const flipped = Buffer.from(parts[4] ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    parts[4] = flipped.toString('base64url');

    await expect(box.open(parts.join('.'))).rejects.toThrow();
  });

  it('refuses a value whose wrapped key came from elsewhere', async () => {
    const mine = cipher();
    const theirs = new EnvelopeCipher(new LocalKeyProvider(randomBytes(32).toString('base64')));

    // Someone who can write to the database but not read the key cannot swap
    // in a value of their own choosing.
    await expect(
      mine.open(await theirs.seal('their password')).catch((e) => {
        throw e;
      }),
    ).rejects.toThrow();
  });

  it('refuses anything that is not in its format', async () => {
    const box = cipher();
    for (const value of ['', 'plaintext', 'v1.a.b.c.d.e', 'v2.only.three.parts']) {
      await expect(box.open(value)).rejects.toThrow();
    }
  });

  it('records which master key sealed it, so rotation can find the stragglers', async () => {
    expect(EnvelopeCipher.keyIdOf(await cipher().seal('x'))).toBe('local');
    expect(EnvelopeCipher.keyIdOf('not sealed')).toBeNull();
  });

  it('compares without revealing, and without leaking through timing', async () => {
    const box = cipher();
    const sealed = await box.seal('EmaraTax!2026');
    expect(await box.holdsSame(sealed, 'EmaraTax!2026')).toBe(true);
    expect(await box.holdsSame(sealed, 'EmaraTax!2027')).toBe(false);
    expect(await box.holdsSame('rubbish', 'anything')).toBe(false);
  });

  it('insists on a master key of the right size rather than quietly weakening', () => {
    expect(() => new LocalKeyProvider(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new LocalKeyProvider('not base64 at all!!')).toThrow();
  });
});

describe('the credential vault', () => {
  function build() {
    const recorded: SecretAccess[] = [];
    const recorder: SecretAccessRecorder = {
      record: vi.fn(async (access) => {
        recorded.push(access);
      }),
    };
    return { recorded, recorder, vault: new AuditedVault(cipher(), recorder) };
  }

  it('records every read, because there is no other way in', async () => {
    const { vault, recorded } = build();
    const sealed = await vault.seal('EmaraTax!2026');

    expect(await vault.open(sealed, ACCESS)).toBe('EmaraTax!2026');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.actor.userId).toBe('user-1');
    expect(recorded[0]?.reason).toBe('filing the quarterly return');
  });

  it('never puts the secret itself into what it records', async () => {
    const { vault, recorded } = build();
    const sealed = await vault.seal('EmaraTax!2026');
    await vault.open(sealed, ACCESS);

    expect(JSON.stringify(recorded)).not.toContain('EmaraTax!2026');
    expect(recorded[0]?.label).toBe('emaratax.password');
  });

  it('refuses to hand over the secret when the reading cannot be recorded', async () => {
    const vault = new AuditedVault(cipher(), {
      record: async () => {
        throw new Error('the audit log is unavailable');
      },
    });
    const sealed = await vault.seal('EmaraTax!2026');

    // The right way round: in a system whose audit trail is a requirement, a
    // credential that cannot be logged is a credential that is not handed out.
    await expect(vault.open(sealed, ACCESS)).rejects.toThrow('the audit log is unavailable');
  });

  it('counts checking a credential as using it', async () => {
    const { vault, recorded } = build();
    const sealed = await vault.seal('EmaraTax!2026');

    expect(await vault.matches(sealed, 'EmaraTax!2026', ACCESS)).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it('sealing is not an access, so setting a password does not read one', async () => {
    const { vault, recorded } = build();
    await vault.seal('EmaraTax!2026');
    expect(recorded).toHaveLength(0);
  });
});

describe('the KMS provider', () => {
  it('binds each data key to an encryption context, so a moved row will not open', async () => {
    const sent: Record<string, unknown>[] = [];
    const kms = {
      send: vi.fn(async (command: { input: Record<string, unknown> }) => {
        sent.push(command.input);
        return {
          Plaintext: new Uint8Array(randomBytes(32)),
          CiphertextBlob: new Uint8Array(randomBytes(64)),
        };
      }),
    };
    class Fake {
      constructor(readonly input: Record<string, unknown>) {}
    }

    const provider = new KmsKeyProvider(
      kms,
      'arn:aws:kms:me-central-1:key/1',
      {
        generateDataKey: Fake,
        decrypt: Fake,
      },
      { system: 'amc', purpose: 'credentials' },
    );

    await provider.generate();

    expect(sent[0]?.KeySpec).toBe('AES_256');
    // The context is what stops a ciphertext being moved from one row to
    // another by someone who can write to the database but not read the key.
    expect(sent[0]?.EncryptionContext).toEqual({ system: 'amc', purpose: 'credentials' });
  });

  it('complains rather than proceeding when KMS returns nothing usable', async () => {
    class Fake {
      constructor(readonly input: unknown) {}
    }
    const provider = new KmsKeyProvider({ send: async () => ({}) }, 'key', {
      generateDataKey: Fake,
      decrypt: Fake,
    });

    await expect(provider.generate()).rejects.toThrow('no data key');
    await expect(provider.decrypt(Buffer.alloc(8))).rejects.toThrow('could not decrypt');
  });
});
