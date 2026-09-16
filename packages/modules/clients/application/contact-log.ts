import type { Conflict, IdGenerator, Result } from '@amc/kernel';
import { err, ok } from '@amc/kernel';
import { ContactLogEntry, scopeFor } from '../domain/index.js';
import type { CallerLike, ContactLogRepository } from './ports.js';

/** Where a screenshot goes. Declared here so the module never depends on S3. */
export interface ContactFileStore {
  put(params: {
    clientId: string;
    entryId: string;
    attachmentId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Result<{ storageKey: string; checksum: string; sizeBytes: number }, Conflict>>;
  linkTo(storageKey: string, downloadName: string | null): Promise<string>;
}

export interface ContactLogView {
  readonly id: string;
  readonly channel: string;
  readonly direction: string;
  readonly happenedAt: string;
  readonly summary: string;
  readonly taskId: string | null;
  readonly attachments: { id: string; name: string; contentType: string; sizeBytes: number }[];
}

export interface RecordContactCommand {
  readonly clientId: string;
  readonly channel: string;
  readonly direction: string;
  readonly happenedAt: Date;
  readonly summary: string;
  readonly taskId?: string | undefined;
  readonly contactId?: string | undefined;
  readonly files: readonly { filename: string; contentType: string; body: Buffer }[];
}

/**
 * What was said to a client, and the screenshots that prove it (FR-06).
 *
 * A practice that chases people for documents lives on this. "We asked three
 * times" is only worth saying if it can be shown, and the escalation ladder
 * counts days from when the client was actually asked — which is why the time
 * the conversation happened is recorded separately from the time it was typed
 * up.
 */
export class ContactLog {
  constructor(
    private readonly entries: ContactLogRepository,
    private readonly files: ContactFileStore,
    private readonly ids: IdGenerator,
  ) {}

  private scope(caller: CallerLike) {
    const held =
      caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions);
    return scopeFor(held, caller.userId);
  }

  async forClient(caller: CallerLike, clientId: string): Promise<ContactLogView[]> {
    const entries = await this.entries.forClient(clientId, this.scope(caller));
    return entries.map((entry) => {
      const state = entry.snapshot();
      return {
        id: state.id,
        channel: state.channel,
        direction: state.direction,
        happenedAt: state.happenedAt.toISOString(),
        summary: state.summary,
        taskId: state.taskId,
        attachments: state.attachments.map((file) => ({
          id: file.id,
          name: file.originalName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        })),
      };
    });
  }

  async record(
    caller: CallerLike,
    command: RecordContactCommand,
  ): Promise<Result<{ entryId: string }, Conflict>> {
    const entryId = this.ids.next();
    const entry = ContactLogEntry.record({
      id: entryId,
      clientId: command.clientId,
      ...(command.contactId === undefined ? {} : { contactId: command.contactId }),
      userId: caller.userId,
      channel: command.channel,
      direction: command.direction,
      happenedAt: command.happenedAt,
      summary: command.summary,
      ...(command.taskId === undefined ? {} : { taskId: command.taskId }),
      now: new Date(),
    });
    if (!entry.ok) return err(entry.error);

    /*
     * The files are stored before the row is written, for the same reason a
     * document is: a rolled-back row leaves an orphan object, which costs
     * kilobytes and can be swept, while the other order leaves a row claiming
     * a screenshot that was never written — and nobody finds out until they
     * need it to prove the client was asked.
     */
    for (const file of command.files) {
      const attachmentId = this.ids.next();
      const stored = await this.files.put({
        clientId: command.clientId,
        entryId,
        attachmentId,
        filename: file.filename,
        contentType: file.contentType,
        body: file.body,
      });
      if (!stored.ok) return err(stored.error);

      entry.value.attach({
        id: attachmentId,
        storageKey: stored.value.storageKey,
        originalName: file.filename,
        contentType: file.contentType,
        checksum: stored.value.checksum,
        sizeBytes: stored.value.sizeBytes,
      });
    }

    await this.entries.save(entry.value);
    return ok({ entryId });
  }

  /** A link to one screenshot, good for a few minutes. */
  async linkTo(caller: CallerLike, clientId: string, attachmentId: string): Promise<string | null> {
    const entries = await this.entries.forClient(clientId, this.scope(caller));
    for (const entry of entries) {
      const found = entry.snapshot().attachments.find((file) => file.id === attachmentId);
      if (found) return this.files.linkTo(found.storageKey, found.originalName);
    }
    // Out of scope and non-existent answer alike.
    return null;
  }
}
