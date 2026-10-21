import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';

/** Deepest a folder may sit: the client's own folder is level 0. */
export const MAX_FOLDER_DEPTH = 6;
const MAX_NAME = 80;

/**
 * What a folder may be called.
 *
 * A name somebody typed, shown back to them, so it is kept as typed apart from
 * trimming. What is refused is what would make a path ambiguous or a name
 * unreadable: slashes and control characters.
 */
export function cleanFolderName(raw: string): Result<string, Conflict> {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) return err(new Conflict('Give the folder a name'));
  if (name.length > MAX_NAME) {
    return err(new Conflict(`A folder name is at most ${MAX_NAME} characters`));
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\\/\u0000-\u001f]/.test(name)) {
    return err(new Conflict('A folder name cannot contain slashes'));
  }
  if (name === '.' || name === '..') return err(new Conflict('That is not a folder name'));
  return ok(name);
}

export interface ClientFolderState {
  readonly id: string;
  readonly clientId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly removedAt: Date | null;
  readonly removedBy: string | null;
}

/** A folder inside a client's folder. */
export class ClientFolder extends AggregateRoot<string> {
  private constructor(private state: ClientFolderState) {
    super(state.id);
  }

  static rehydrate(state: ClientFolderState): ClientFolder {
    return new ClientFolder(state);
  }

  static create(params: {
    id: string;
    clientId: string;
    parentId: string | null;
    name: string;
    createdBy: string;
    now: Date;
  }): Result<ClientFolder, Conflict> {
    const name = cleanFolderName(params.name);
    if (!name.ok) return err(name.error);

    const folder = new ClientFolder({
      id: params.id,
      clientId: params.clientId,
      parentId: params.parentId,
      name: name.value,
      createdBy: params.createdBy,
      createdAt: params.now,
      removedAt: null,
      removedBy: null,
    });
    folder.record(
      domainEvent('clients.folder.created', params.id, params.now, {
        folderId: params.id,
        clientId: params.clientId,
        parentId: params.parentId,
        name: name.value,
      }),
    );
    return ok(folder);
  }

  get clientId(): string {
    return this.state.clientId;
  }
  get parentId(): string | null {
    return this.state.parentId;
  }
  get isRemoved(): boolean {
    return this.state.removedAt !== null;
  }

  rename(raw: string, now: Date): Result<void, Conflict> {
    if (this.isRemoved) return err(new Conflict('That folder has been removed'));
    const name = cleanFolderName(raw);
    if (!name.ok) return err(name.error);
    if (name.value === this.state.name) return ok(undefined);

    const from = this.state.name;
    this.state = { ...this.state, name: name.value };
    this.record(
      domainEvent('clients.folder.renamed', this.id, now, {
        folderId: this.id,
        clientId: this.state.clientId,
        from,
        to: name.value,
      }),
    );
    return ok(undefined);
  }

  /** Whether anything is still inside is the caller's question: this does not know. */
  remove(by: string, now: Date): Result<void, Conflict> {
    if (this.isRemoved) return err(new Conflict('That folder has already been removed'));
    this.state = { ...this.state, removedAt: now, removedBy: by };
    this.record(
      domainEvent('clients.folder.removed', this.id, now, {
        folderId: this.id,
        clientId: this.state.clientId,
        name: this.state.name,
      }),
    );
    return ok(undefined);
  }

  snapshot(): ClientFolderState {
    return this.state;
  }
}
