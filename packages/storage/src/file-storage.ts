import type { Readable } from 'node:stream';

export interface StoredFile {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  /**
   * SHA-256 of the contents. It proves the file behind an approved ledger
   * entry is still the file that was approved (FR-58), and it identifies a
   * duplicate upload before anything is extracted from it.
   */
  readonly checksum: string;
  readonly storedAt: Date;
  readonly originalName?: string | undefined;
}

export interface PutOptions {
  readonly contentType: string;
  /** The name the person uploaded it under, kept for display only. */
  readonly originalName?: string | undefined;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
}

export interface PresignOptions {
  readonly expiresInSeconds: number;
  /** Makes the browser save it under this name rather than the key. */
  readonly downloadName?: string | undefined;
}

/**
 * Where documents live. One interface, so the same code runs against a folder
 * in development and against S3 in me-central-1 in production.
 */
export interface FileStorage {
  put(key: string, body: Buffer, options: PutOptions): Promise<StoredFile>;
  get(key: string): Promise<{ body: Readable; file: StoredFile }>;
  /** Returns null rather than throwing, because "is it there?" is a question. */
  head(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
  /** A link that works for a while and then does not. */
  presignGet(key: string, options: PresignOptions): Promise<string>;
}

export class FileNotFound extends Error {
  readonly code = 'FILE_NOT_FOUND';
  constructor(readonly key: string) {
    super(`No stored file at ${key}`);
    this.name = 'FileNotFound';
  }
}

export class FileTooLarge extends Error {
  readonly code = 'FILE_TOO_LARGE';
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`That file is ${size} bytes; the limit is ${limit}`);
    this.name = 'FileTooLarge';
  }
}
