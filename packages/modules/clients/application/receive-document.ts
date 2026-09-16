import type { Actor, Conflict, EventCollector, Result, UnitOfWork } from '@amc/kernel';
import { Conflict as ConflictError, type IdGenerator, err, ok } from '@amc/kernel';
import {
  ClientDocument,
  type DocumentTypeCode,
  isDocumentType,
  scopeFor,
} from '../domain/index.js';
import type { CallerLike, DocumentRepository } from './ports.js';

/**
 * Where the bytes go.
 *
 * Declared here rather than imported, so the module depends on the idea of
 * storage and not on S3. The key is derived by the storage package and never
 * taken from the upload: a filename is a value the other end chose, and
 * "../../etc/passwd" is a filename.
 */
export interface DocumentFileStore {
  put(params: {
    clientId: string;
    documentId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Result<{ storageKey: string; checksum: string }, Conflict>>;
  /** A link that works for a while and then does not. */
  linkTo(storageKey: string, downloadName: string | null): Promise<string>;
}

export interface DocumentRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): DocumentRepository;
}

export interface UploadCommand {
  readonly clientId: string;
  readonly type: string;
  readonly label?: string | undefined;
  readonly issuedOn?: string | undefined;
  readonly expiresOn?: string | undefined;
  readonly replacesId?: string | undefined;
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Receiving a document from a person.
 *
 * The file is written to storage before the transaction opens, and the record
 * inside it. That order is deliberate. If the transaction rolls back, the
 * consequence is an orphaned object in a bucket, which costs a few kilobytes
 * and can be swept. The other order risks a committed row pointing at a file
 * that was never written, which is a document the firm believes it holds and
 * cannot produce — and it would be believed for months, until an auditor asked.
 */
export class ReceiveDocument {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: DocumentRepositoryFactory,
    /** For reads, which need no transaction and must not pretend to have one. */
    private readonly documents: DocumentRepository,
    private readonly files: DocumentFileStore,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    caller: CallerLike,
    command: UploadCommand,
  ): Promise<Result<{ documentId: string }, Conflict>> {
    if (!isDocumentType(command.type)) {
      return err(new ConflictError('That is not a document type this system keeps'));
    }
    const type: DocumentTypeCode = command.type;

    const issuedOn = day(command.issuedOn);
    const expiresOn = day(command.expiresOn);
    if (command.issuedOn && !issuedOn)
      return err(new ConflictError('That issue date is not a date'));
    if (command.expiresOn && !expiresOn) {
      return err(new ConflictError('That expiry date is not a date'));
    }

    const documentId = this.ids.next();
    const stored = await this.files.put({
      clientId: command.clientId,
      documentId,
      filename: command.filename,
      contentType: command.contentType,
      body: command.body,
    });
    if (!stored.ok) return err(stored.error);

    const actor: Actor = {
      userId: caller.userId,
      roles: caller.roles,
      label: caller.displayName,
      ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
    };

    return this.unitOfWork.run(actor, async (context) => {
      const documents = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const scope = scopeFor(
        caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions),
        caller.userId,
      );

      const label = command.label?.trim() || null;
      const replacing = await this.whatThisReplaces(documents, scope, command, type, label);
      if (!replacing.ok) return replacing;
      const replaced = replacing.value;

      const now = new Date();
      /*
       * The old one is superseded first and the new one inserted second.
       *
       * Both orders are refused by a different rule if attempted the other way
       * round: the unique index on live documents will not have two, and the
       * foreign key will not point at a row that does not exist yet. The key
       * is deferred to commit for exactly this, so superseding first is the
       * order that works. See migration 0008.
       */
      if (replaced) {
        const superseded = replaced.supersede(documentId, now);
        if (!superseded.ok) return err(superseded.error);
        await documents.save(replaced);
      }

      const document = ClientDocument.require({
        id: documentId,
        clientId: command.clientId,
        type,
        label,
        now,
      });

      const received = document.receive({
        storageKey: stored.value.storageKey,
        originalName: command.filename,
        checksum: stored.value.checksum,
        issuedOn,
        expiresOn,
        uploadedBy: caller.userId,
        now,
      });
      if (!received.ok) return err(received.error);

      await documents.save(document);
      return ok({ documentId });
    });
  }

  /**
   * What this upload replaces, if anything.
   *
   * Named explicitly when the person picked a document to renew. Found
   * otherwise, because the database holds one current document of each type
   * per client and a second trade licence *is* the renewal of the first.
   * Making someone pass an id they would have to look up would turn the
   * ordinary case into the awkward one, and getting it wrong surfaces as a
   * unique-index violation rather than as an explanation.
   */
  private async whatThisReplaces(
    documents: DocumentRepository,
    scope: ReturnType<typeof scopeFor>,
    command: UploadCommand,
    type: DocumentTypeCode,
    label: string | null,
  ): Promise<Result<ClientDocument | null, Conflict>> {
    if (command.replacesId) {
      const named = await documents.findById(command.replacesId, scope);
      // Out of scope and non-existent answer alike, so a replacement cannot
      // be used to learn which clients hold which documents.
      if (!named || named.clientId !== command.clientId) {
        return err(new ConflictError('No such document to replace'));
      }
      return ok(named);
    }

    const current = await documents.currentFor(command.clientId, scope);
    return ok(
      current.find(
        (candidate) =>
          candidate.type === type &&
          (candidate.snapshot().label ?? null) === label &&
          !candidate.isSuperseded,
      ) ?? null,
    );
  }

  /** A link the browser can follow, for as long as it is meant to work. */
  async linkTo(caller: CallerLike, documentId: string): Promise<string | null> {
    const scope = scopeFor(
      caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions),
      caller.userId,
    );
    const document = await this.documents.findById(documentId, scope);
    // A document out of scope and a document that was never uploaded give the
    // same answer, so a link cannot be used to learn which clients exist.
    if (!document?.storageKey) return null;
    return this.files.linkTo(document.storageKey, document.snapshot().originalName);
  }
}

/** A calendar day, or null when there was nothing usable to read. */
function day(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
