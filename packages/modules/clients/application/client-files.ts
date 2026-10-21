import type { ClientFileView, ClientFolderView } from '@amc/contracts';
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
import {
  ClientFile,
  ClientFolder,
  MAX_FOLDER_DEPTH,
  cleanFileName,
  refuseFile,
  scopeFor,
} from '../domain/index.js';
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
        folderId: state.folderId,
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
    folderId: string | null = null,
  ): Promise<Result<UploadOutcome, Conflict>> {
    const refused: { name: string; reason: string }[] = [];
    let kept = 0;

    // Asked once, before any file is stored: a folder that is not this client's
    // refuses the whole drop rather than each file in turn.
    const placed = await this.folderFor(caller, clientId, folderId);
    if (!placed.ok) return err(placed.error);

    for (const upload of uploads) {
      const outcome = await this.keep(caller, clientId, upload, folderId);
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
    folderId: string | null,
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
        folderId,
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

  /** Whether a folder exists, is open, and belongs to this client. Null means the top. */
  private async folderFor(
    caller: CallerLike,
    clientId: string,
    folderId: string | null,
  ): Promise<Result<true, Conflict>> {
    if (folderId === null) return ok(true as const);
    const folder = await this.files.findFolder(folderId, scopeFor(caller));
    if (!folder || folder.isRemoved || folder.clientId !== clientId) {
      return err(new Conflict('No such folder'));
    }
    return ok(true as const);
  }

  async folders(caller: CallerLike, clientId: string): Promise<ClientFolderView[]> {
    const stored = await this.files.foldersFor(clientId, scopeFor(caller));
    return stored.map(({ folder, fileCount }) => {
      const state = folder.snapshot();
      return { id: state.id, parentId: state.parentId, name: state.name, fileCount };
    });
  }

  async createFolder(
    caller: CallerLike,
    clientId: string,
    name: string,
    parentId: string | null,
  ): Promise<Result<string, Conflict>> {
    if (!(await this.files.canReach(clientId, scopeFor(caller)))) {
      return err(new Conflict('No such client'));
    }
    const parent = await this.folderFor(caller, clientId, parentId);
    if (!parent.ok) return err(parent.error);
    if (parentId !== null && (await this.files.depthOf(parentId)) >= MAX_FOLDER_DEPTH) {
      return err(new Conflict(`Folders go at most ${MAX_FOLDER_DEPTH} levels deep`));
    }

    const id = this.ids.next();
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const folder = ClientFolder.create({
        id,
        clientId,
        parentId,
        name,
        createdBy: caller.userId,
        now: new Date(),
      });
      if (!folder.ok) return err(folder.error);
      if (await repository.nameTaken(clientId, parentId, folder.value.snapshot().name)) {
        return err(new Conflict('There is already a folder with that name here'));
      }
      await repository.saveFolder(folder.value);
      return ok(id);
    });
  }

  async renameFolder(
    caller: CallerLike,
    folderId: string,
    name: string,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const folder = await repository.findFolder(folderId, scopeFor(caller));
      if (!folder || folder.isRemoved) return err(new Conflict('No such folder'));

      const renamed = folder.rename(name, new Date());
      if (!renamed.ok) return err(renamed.error);
      const state = folder.snapshot();
      if (await repository.nameTaken(state.clientId, state.parentId, state.name, folderId)) {
        return err(new Conflict('There is already a folder with that name here'));
      }
      await repository.saveFolder(folder);
      return ok(true as const);
    });
  }

  /** Only an empty folder. Anything inside has to be moved or removed first, on purpose. */
  async removeFolder(caller: CallerLike, folderId: string): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const folder = await repository.findFolder(folderId, scopeFor(caller));
      if (!folder || folder.isRemoved) return err(new Conflict('No such folder'));
      if (await repository.folderHasContents(folderId)) {
        return err(new Conflict('Move or remove what is inside this folder first'));
      }

      const removed = folder.remove(caller.userId, new Date());
      if (!removed.ok) return err(removed.error);
      await repository.saveFolder(folder);
      return ok(true as const);
    });
  }

  /** Moves a file into a folder, or to the top of the client's folder when null. */
  async moveFile(
    caller: CallerLike,
    fileId: string,
    folderId: string | null,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const file = await repository.findById(fileId, scopeFor(caller));
      if (!file || file.isRemoved) return err(new Conflict('No such file'));

      if (folderId !== null) {
        const folder = await repository.findFolder(folderId, scopeFor(caller));
        if (!folder || folder.isRemoved || folder.clientId !== file.clientId) {
          return err(new Conflict('No such folder'));
        }
      }
      const moved = file.moveTo(folderId, new Date());
      if (!moved.ok) return err(moved.error);
      await repository.save(file);
      return ok(true as const);
    });
  }
}
