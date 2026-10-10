import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';

/**
 * A file kept in a client's folder.
 *
 * Anything at all, with two exceptions: nothing that a computer would run, and
 * nothing with no name or no content. The folder is for what a client sends
 * and what the firm wants to keep with them, and "any file" is the point — but
 * a folder that accepts a program is a way to hand one to whoever opens it
 * next, and nobody asked for that.
 */

/** Things that run when opened. Refused whatever they are called inside. */
export const REFUSED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'jar',
  'sh',
  'app',
  'dmg',
  'apk',
  'dll',
  'lnk',
  'hta',
  'reg',
]);

export const MAX_FILE_NAME = 200;

export interface ClientFileState {
  readonly id: string;
  readonly clientId: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  readonly uploadedAt: Date;
  readonly removedAt: Date | null;
  readonly removedBy: string | null;
}

/** The last extension in a name, lower-cased: "a.tar.gz" is "gz". */
export function extensionOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * A name fit to show and to put in a download header.
 *
 * Path parts are dropped — some browsers send the whole path — control
 * characters go, and a very long name is cut keeping its extension, because
 * the extension is what tells somebody what they are about to open.
 */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const printable = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  if (printable.length <= MAX_FILE_NAME) return printable;
  const extension = extensionOfName(printable);
  const tail = extension ? `.${extension.slice(0, 10)}` : '';
  return `${printable.slice(0, MAX_FILE_NAME - tail.length)}${tail}`;
}

/**
 * Why a file cannot be kept, or null if it can.
 *
 * Asked before anything is written to storage as well as when the record is
 * made: a refusal after the bytes are stored leaves an orphan, and one before
 * costs nothing.
 */
export function refuseFile(rawName: string, sizeBytes: number): Conflict | null {
  const name = cleanFileName(rawName);
  if (name.length === 0) return new Conflict('That file has no name');
  if (sizeBytes <= 0) {
    // An empty file is almost always a failed export or a dropped upload,
    // and keeping it means somebody opens it later and finds nothing.
    return new Conflict(`${name} is empty`);
  }
  if (REFUSED_EXTENSIONS.has(extensionOfName(name))) {
    return new Conflict(`${name} is a program, and programs are not kept in a client folder`);
  }
  return null;
}

export class ClientFile extends AggregateRoot<string> {
  private constructor(private state: ClientFileState) {
    super(state.id);
  }

  static rehydrate(state: ClientFileState): ClientFile {
    return new ClientFile(state);
  }

  static receive(params: {
    id: string;
    clientId: string;
    storageKey: string;
    name: string;
    contentType: string;
    checksum: string;
    sizeBytes: number;
    uploadedBy: string;
    now: Date;
  }): Result<ClientFile, Conflict> {
    const refusal = refuseFile(params.name, params.sizeBytes);
    if (refusal) return err(refusal);
    const name = cleanFileName(params.name);

    const file = new ClientFile({
      id: params.id,
      clientId: params.clientId,
      storageKey: params.storageKey,
      originalName: name,
      contentType: params.contentType,
      checksum: params.checksum,
      sizeBytes: params.sizeBytes,
      uploadedBy: params.uploadedBy,
      uploadedAt: params.now,
      removedAt: null,
      removedBy: null,
    });
    file.record(
      domainEvent('clients.file.uploaded', params.id, params.now, {
        fileId: params.id,
        clientId: params.clientId,
        name,
        sizeBytes: params.sizeBytes,
        checksum: params.checksum,
      }),
    );
    return ok(file);
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get isRemoved(): boolean {
    return this.state.removedAt !== null;
  }

  /**
   * Takes it out of the folder.
   *
   * The file itself stays where it is and so does the row: who removed the
   * engagement letter, and when, is a question with a real answer a year on.
   */
  remove(by: string, now: Date): Result<void, Conflict> {
    if (this.state.removedAt) {
      return err(new Conflict('That file has already been removed'));
    }
    this.state = { ...this.state, removedAt: now, removedBy: by };
    this.record(
      domainEvent('clients.file.removed', this.id, now, {
        fileId: this.id,
        clientId: this.state.clientId,
        name: this.state.originalName,
      }),
    );
    return ok(undefined);
  }

  snapshot(): ClientFileState {
    return this.state;
  }
}
