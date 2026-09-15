import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  FileNotFound,
  type FileStorage,
  FileTooLarge,
  type PresignOptions,
  type PutOptions,
  type StoredFile,
} from './file-storage.js';

interface Sidecar {
  contentType: string;
  checksum: string;
  size: number;
  storedAt: string;
  originalName?: string;
  metadata?: Record<string, string>;
}

/**
 * Files in a folder, for development and tests.
 *
 * It exists so the storage path is exercised for real rather than mocked: the
 * same code, the same keys, the same checksums. Only the destination differs.
 */
export class LocalFileStorage implements FileStorage {
  constructor(
    private readonly root: string,
    private readonly signingKey: string,
    private readonly maxBytes = 25 * 1024 * 1024,
  ) {}

  /**
   * Resolves a key to a path and refuses anything that escapes the root.
   * The key rules already prevent this; checking again here costs nothing and
   * means a future caller that builds a key by hand cannot reach the disk.
   */
  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    const root = resolve(this.root);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`That key resolves outside the storage root: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<StoredFile> {
    if (body.byteLength > this.maxBytes) throw new FileTooLarge(body.byteLength, this.maxBytes);

    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    const sidecar: Sidecar = {
      contentType: options.contentType,
      checksum: createHash('sha256').update(body).digest('hex'),
      size: body.byteLength,
      storedAt: new Date().toISOString(),
      ...(options.originalName ? { originalName: options.originalName } : {}),
      ...(options.metadata ? { metadata: { ...options.metadata } } : {}),
    };
    await writeFile(`${path}.meta.json`, JSON.stringify(sidecar, null, 2));

    return toStoredFile(key, sidecar);
  }

  async head(key: string): Promise<StoredFile | null> {
    try {
      const sidecar = JSON.parse(
        await readFile(`${this.pathFor(key)}.meta.json`, 'utf8'),
      ) as Sidecar;
      return toStoredFile(key, sidecar);
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<{ body: Readable; file: StoredFile }> {
    const file = await this.head(key);
    if (!file) throw new FileNotFound(key);
    return { body: createReadStream(this.pathFor(key)), file };
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  /**
   * There is no S3 to sign against, so the link is signed here and verified by
   * the API when it serves the file. Same shape as the real thing: a URL that
   * works for a while and then does not.
   */
  async presignGet(key: string, options: PresignOptions): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    const signature = this.sign(key, expiresAt);
    const query = new URLSearchParams({ expires: String(expiresAt), signature });
    if (options.downloadName) query.set('name', options.downloadName);
    return `/api/files/${key}?${query.toString()}`;
  }

  /** Whether a link this storage produced is still good. */
  verify(key: string, expires: string, signature: string, now = new Date()): boolean {
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt)) return false;
    if (expiresAt * 1000 <= now.getTime()) return false;

    const expected = Buffer.from(this.sign(key, expiresAt), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  private sign(key: string, expiresAt: number): string {
    return createHmac('sha256', this.signingKey).update(`${key}:${expiresAt}`).digest('hex');
  }
}

function toStoredFile(key: string, sidecar: Sidecar): StoredFile {
  return {
    key,
    size: sidecar.size,
    contentType: sidecar.contentType,
    checksum: sidecar.checksum,
    storedAt: new Date(sidecar.storedAt),
    originalName: sidecar.originalName,
  };
}
