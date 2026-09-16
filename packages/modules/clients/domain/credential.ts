import { Conflict, type Result, err, ok } from '@amc/kernel';

/** What a stored credential opens. */
export type CredentialKind = 'emaratax' | 'ftaportal' | 'bank_portal' | 'other';

const KINDS: readonly CredentialKind[] = ['emaratax', 'ftaportal', 'bank_portal', 'other'];

export function isCredentialKind(value: string): value is CredentialKind {
  return (KINDS as readonly string[]).includes(value);
}

export interface CredentialState {
  readonly id: string;
  readonly clientId: string;
  readonly kind: CredentialKind;
  readonly username: string;
  /** Sealed. The plaintext never exists on this object. */
  readonly secretSealed: string;
  readonly note: string | null;
  readonly retiredAt: Date | null;
  readonly retiredBy: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

/**
 * A client's login to a government portal (FR-05).
 *
 * The aggregate holds the sealed value and never the plaintext. That is not a
 * convention: there is no field for a password here, so no code path can hold
 * one in memory longer than the moment it is sealed, and no accidental log of
 * this object can print one.
 *
 * Opening a credential is not a method on this class either. It goes through
 * the vault, which writes the audit row before it returns the plaintext, so
 * there is exactly one route in and it is a recorded one.
 */
export class ClientCredential {
  private constructor(private state: CredentialState) {}

  static rehydrate(state: CredentialState): ClientCredential {
    return new ClientCredential(state);
  }

  static store(params: {
    id: string;
    clientId: string;
    kind: string;
    username: string;
    secretSealed: string;
    note?: string | null;
    by: string;
    now: Date;
  }): Result<ClientCredential, Conflict> {
    if (!isCredentialKind(params.kind)) {
      return err(new Conflict('That is not a portal this system keeps logins for'));
    }
    const username = params.username.trim();
    if (username.length === 0) return err(new Conflict('A credential needs a username'));
    if (params.secretSealed.trim().length === 0) {
      return err(new Conflict('A credential needs a password'));
    }

    return ok(
      new ClientCredential({
        id: params.id,
        clientId: params.clientId,
        kind: params.kind,
        username,
        secretSealed: params.secretSealed,
        note: params.note?.trim() || null,
        retiredAt: null,
        retiredBy: null,
        createdBy: params.by,
        createdAt: params.now,
      }),
    );
  }

  get id(): string {
    return this.state.id;
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get kind(): CredentialKind {
    return this.state.kind;
  }

  get username(): string {
    return this.state.username;
  }

  /** The sealed value, for the vault to open. Never a password. */
  get secretSealed(): string {
    return this.state.secretSealed;
  }

  get isRetired(): boolean {
    return this.state.retiredAt !== null;
  }

  /**
   * Take it out of use without deleting it.
   *
   * An audit asks who could have filed on this client's behalf last March, and
   * a deleted row cannot answer. Retiring keeps the history and frees the
   * one-live-credential-per-portal rule for its replacement.
   */
  retire(by: string, now: Date): Result<true, Conflict> {
    if (this.state.retiredAt) return err(new Conflict('That credential is already retired'));
    this.state = { ...this.state, retiredAt: now, retiredBy: by };
    return ok(true);
  }

  snapshot(): CredentialState {
    return this.state;
  }
}
