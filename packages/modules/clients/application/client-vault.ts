import type { CredentialSummary } from '@amc/contracts';
import {
  type Actor,
  Conflict,
  Conflict as ConflictError,
  type IdGenerator,
  type Result,
  actorFrom,
  err,
  heldBy,
  ok,
} from '@amc/kernel';
import { ClientCredential, scopeFor } from '../domain/index.js';
import type { CallerLike, CredentialRepository } from './ports.js';

/**
 * The vault, as this module needs it.
 *
 * Declared here rather than imported so the clients module never depends on
 * the vault package. What matters is the shape: `open` takes the access it is
 * about to record, because recording is not a step the caller performs
 * afterwards and might forget.
 */
export interface SecretVault {
  seal(plaintext: string): Promise<string>;
  open(
    sealed: string,
    access: {
      actor: Actor;
      entityType: string;
      entityId: string;
      label: string;
      reason?: string | undefined;
    },
  ): Promise<string>;
}

/**
 * A client's logins to the government portals they file through (FR-05).
 *
 * The password leaves this class exactly once, through `reveal`, and that
 * method cannot run without writing to the audit log first. There is no
 * "get the credential" that skips it, because the recording happens inside the
 * vault rather than beside it.
 *
 * Listing is deliberately separate from revealing. Opening the client file
 * should not log a password read for every credential on it, or the log fills
 * with noise and the one real read is impossible to find.
 */
export class ClientVault {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly vault: SecretVault,
    private readonly ids: IdGenerator,
  ) {}

  /** Usernames and notes. Never a password, so this is not a logged read. */
  async list(caller: CallerLike, clientId: string): Promise<CredentialSummary[]> {
    if (!heldBy(caller).has('clients.vault.read')) return [];

    const stored = await this.credentials.currentFor(clientId, scopeFor(caller));
    return stored.map((credential) => {
      const state = credential.snapshot();
      return {
        id: state.id,
        kind: state.kind,
        username: state.username,
        note: state.note,
        createdAt: state.createdAt.toISOString(),
      };
    });
  }

  /**
   * The password, and a row in the audit log saying who read it and why.
   *
   * The reason is required. A log that records twenty reads and no reasons
   * tells an auditor that somebody looked, which they could have guessed.
   */
  async reveal(
    caller: CallerLike,
    credentialId: string,
    reason: string,
  ): Promise<Result<{ username: string; secret: string }, Conflict>> {
    if (reason.trim().length < 3) {
      return err(new ConflictError('Say why the password is needed'));
    }

    const credential = await this.credentials.findById(credentialId, scopeFor(caller));
    if (!credential || credential.isRetired) {
      return err(new ConflictError('No such credential'));
    }

    const secret = await this.vault.open(credential.secretSealed, {
      actor: actorFrom(caller),
      entityType: 'client_credential',
      entityId: credential.id,
      label: `${credential.kind} for ${credential.clientId}`,
      reason: reason.trim(),
    });

    return ok({ username: credential.username, secret });
  }

  /**
   * Store a login, replacing whatever was there for that portal.
   *
   * The old one is retired rather than overwritten: an audit asks who could
   * have filed on this client's behalf last March, and a row that was
   * overwritten cannot answer.
   */
  async store(
    caller: CallerLike,
    params: {
      clientId: string;
      kind: string;
      username: string;
      secret: string;
      note?: string | undefined;
    },
  ): Promise<Result<{ credentialId: string }, Conflict>> {
    if (params.secret.trim().length === 0) {
      return err(new ConflictError('A credential needs a password'));
    }

    const scope = scopeFor(caller);
    const existing = (await this.credentials.currentFor(params.clientId, scope)).find(
      (candidate) => candidate.kind === params.kind,
    );

    const now = new Date();
    const credential = ClientCredential.store({
      id: this.ids.next(),
      clientId: params.clientId,
      kind: params.kind,
      username: params.username,
      secretSealed: await this.vault.seal(params.secret),
      ...(params.note === undefined ? {} : { note: params.note }),
      by: caller.userId,
      now,
    });
    if (!credential.ok) return err(credential.error);

    /*
     * Retire first, then store. One live credential of each kind per client
     * is a unique index, and inserting the replacement while the old one is
     * still live is refused by it.
     */
    if (existing) {
      const retired = existing.retire(caller.userId, now);
      if (!retired.ok) return err(retired.error);
      await this.credentials.save(existing);
    }

    await this.credentials.save(credential.value);
    return ok({ credentialId: credential.value.id });
  }

  /** Take a login out of use, keeping the record that it existed. */
  async retire(caller: CallerLike, credentialId: string): Promise<Result<true, Conflict>> {
    const credential = await this.credentials.findById(credentialId, scopeFor(caller));
    if (!credential) return err(new ConflictError('No such credential'));

    const retired = credential.retire(caller.userId, new Date());
    if (!retired.ok) return err(retired.error);

    await this.credentials.save(credential);
    return ok(true);
  }
}
