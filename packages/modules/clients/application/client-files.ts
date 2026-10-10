import type { ClientFileView } from '@amc/contracts';
import {
  Conflict,
  type EventCollector,
  type IdGenerator,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  ok,
} from '@amc/kernel';
import { ClientFile, cleanFileName, refuseFile, scopeFor } from '../domain/index.js';
import type { CallerLike, ClientFileRepository } from './ports.js';

/** Where the bytes go. Declared here so the module never depends on S3. */
export interface ClientFileStore {
  put(params: {
    clientId: string;
    fileId: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<Result<{ storageKey: string; checksum: string; contentType: string }, Conflict>>;
  linkTo(storageKey: string, downloadName: string | null): Promise<string>;
}

export interface ClientFileRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): ClientFileRepository;
}

export interface FileUpload {
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
}

export interface UploadOutcome {
  readonly kept: number;
  readonly refused: readonly { name: string; reason: string }[];
}

/**
 * The folder every client has: any file, kept with them.
 *
 * Several files can arrive together, and one being refused does not lose the
 * others. Somebody dropping twelve statements into a folder and being told
 * "no" because the ninth was a program has to start again from nothing; being
 * told which one and why, with the other eleven kept, is the answer they want.
 */
export class ClientFiles {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: ClientFileRepositoryFactory,
    /** For reads, which need no transaction and must not pretend to have one. */
    private readonly files: ClientFileRepository,
    private readonly store: ClientFileStore,
    private readonly ids: IdGenerator,
  ) {}

  async list(caller: CallerLike, clientId: string): Promise<ClientFileView[]> {
    const stored = await this.files.forClient(clientId, scopeFor(caller));
    return stored.map(({ file, uploadedByName }) => {
      const state = file.snapshot();
      return {
        id: state.id,
        name: state.originalName,
        contentType: state.contentType,
        sizeBytes: state.sizeBytes,
        uploadedAt: state.uploadedAt.toISOString(),
        uploadedBy: uploadedByName,
      };
    });
  }

  async upload(
    caller: CallerLike,
    clientId: string,
    uploads: readonly FileUpload[],
  ): Promise<Result<UploadOutcome, Conflict>> {
    const refused: { name: string; reason: string }[] = [];
    let kept = 0;

    for (const upload of uploads) {
      const outcome = await this.keep(caller, clientId, upload);
      if (outcome.ok) kept += 1;
      else refused.push({ name: upload.filename, reason: outcome.error.message });
    }

    // Nothing kept and a reason for each is a refusal; some kept is a success
    // that says what it left out.
    if (kept === 0 && refused.length > 0) {
      return err(new Conflict(refused.map((one) => one.reason).join('; ')));
    }
    return ok({ kept, refused });
  }

  /**
   * One file: checked, stored, then recorded.
   *
   * Checked before it is written to storage — the domain refuses a program or
   * an empty file — and stored before the transaction opens, so a rolled-back
   * row leaves an orphan object that costs kilobytes and can be swept, instead
   * of a row claiming a file that was never written.
   */
  private async keep(
    caller: CallerLike,
    clientId: string,
    upload: FileUpload,
  ): Promise<Result<string, Conflict>> {
    // Out of scope reads as not there, whatever the file is. Asked before
    // anything is stored, so a refused upload cannot be used to learn that a
    // company is on the firm's books.
    if (!(await this.files.canReach(clientId, scopeFor(caller)))) {
      return err(new Conflict('No such client'));
    }

    // Checked before storage as well as when the record is made: a refusal
    // after the bytes are written leaves an orphan, and one before costs nothing.
    const refusal = refuseFile(upload.filename, upload.body.byteLength);
    if (refusal) return err(refusal);

    const fileId = this.ids.next();

    const stored = await this.store.put({
      clientId,
      fileId,
      filename: cleanFileName(upload.filename),
      contentType: upload.contentType,
      body: upload.body,
    });
    if (!stored.ok) return err(stored.error);

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const file = ClientFile.receive({
        id: fileId,
        clientId,
        storageKey: stored.value.storageKey,
        name: upload.filename,
        contentType: stored.value.contentType,
        checksum: stored.value.checksum,
        sizeBytes: upload.body.byteLength,
        uploadedBy: caller.userId,
        now: new Date(),
      });
      if (!file.ok) return err(file.error);

      await repository.save(file.value);
      return ok(fileId);
    });
  }

  async remove(caller: CallerLike, fileId: string): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const file = await repository.findById(fileId, scopeFor(caller));
      if (!file) return err(new Conflict('No such file'));

      const removed = file.remove(caller.userId, new Date());
      if (!removed.ok) return err(removed.error);

      await repository.save(file);
      return ok(true as const);
    });
  }

  /** A link the browser can follow for a few minutes. Null if there is no such file. */
  async linkTo(caller: CallerLike, fileId: string): Promise<string | null> {
    const file = await this.files.findById(fileId, scopeFor(caller));
    if (!file || file.isRemoved) return null;
    const state = file.snapshot();
    return this.store.linkTo(state.storageKey, state.originalName);
  }
}
