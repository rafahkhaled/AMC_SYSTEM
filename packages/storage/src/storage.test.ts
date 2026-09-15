import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileNotFound, FileTooLarge } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';
import {
  clientDocumentKey,
  contentTypeFor,
  extensionOf,
  invoiceBatchKey,
  storageKey,
} from './storage-key.js';

describe('storage keys', () => {
  it('builds a key for a client document', () => {
    const key = clientDocumentKey({ clientId: 'c1', documentId: 'd1', extension: 'pdf' });
    expect(key.ok && key.value).toBe('clients/c1/documents/d1.pdf');
  });

  it('builds a key inside the batch an invoice arrived with', () => {
    const key = invoiceBatchKey({ clientId: 'c1', batchId: 'b1', itemId: 'i1', extension: '.PDF' });
    expect(key.ok && key.value).toBe('clients/c1/batches/b1/i1.pdf');
  });

  it('refuses a name that climbs out of where it belongs', () => {
    // A filename that arrives with an upload is a value someone chose, and
    // "../../etc/passwd" is a filename.
    for (const attempt of ['..', '../secrets', 'a/b', '/absolute', '', '.hidden', 'a\0b']) {
      expect(storageKey([attempt]).ok).toBe(false);
    }
  });

  it('refuses an overlong segment', () => {
    expect(storageKey(['a'.repeat(200)]).ok).toBe(false);
  });

  it('accepts only the document types this system actually takes', () => {
    expect(contentTypeFor('pdf')).toBe('application/pdf');
    expect(contentTypeFor('.JPG')).toBe('image/jpeg');
    // An allowlist, so anything unexpected is refused rather than stored.
    for (const rejected of ['exe', 'js', 'html', 'svg', 'zip', '']) {
      expect(contentTypeFor(rejected)).toBeNull();
    }
  });

  it('reads an extension, and copes with names that have none', () => {
    expect(extensionOf('invoice.final.PDF')).toBe('pdf');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });
});

describe('files in a folder', () => {
  let root: string;
  let storage: LocalFileStorage;
  const signingKey = randomBytes(32).toString('hex');

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'amc-storage-'));
    storage = new LocalFileStorage(root, signingKey, 1024 * 1024);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const body = Buffer.from('%PDF-1.7 a supplier invoice');
  const key = 'clients/c1/documents/d1.pdf';

  it('stores a file and reports its checksum', async () => {
    const stored = await storage.put(key, body, {
      contentType: 'application/pdf',
      originalName: 'فاتورة مارس.pdf',
    });

    expect(stored.size).toBe(body.byteLength);
    expect(stored.checksum).toBe(createHash('sha256').update(body).digest('hex'));
    expect(stored.originalName).toBe('فاتورة مارس.pdf');
  });

  it('gives back exactly what was stored', async () => {
    const { body: stream, file } = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks).equals(body)).toBe(true);
    expect(file.contentType).toBe('application/pdf');
  });

  it('answers "is it there?" with null rather than an exception', async () => {
    expect(await storage.head('clients/c1/documents/nothing.pdf')).toBeNull();
  });

  it('throws when asked for a file that is not there', async () => {
    await expect(storage.get('clients/c1/documents/nothing.pdf')).rejects.toThrow(FileNotFound);
  });

  it('refuses a file over the limit rather than filling the disk', async () => {
    await expect(
      storage.put('clients/c1/documents/huge.pdf', Buffer.alloc(2 * 1024 * 1024), {
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(FileTooLarge);
  });

  it('refuses a key that resolves outside the root, whatever the key rules allowed', async () => {
    await expect(
      storage.put('../escaped.pdf', body, { contentType: 'application/pdf' }),
    ).rejects.toThrow(/outside the storage root/);
  });

  it('removes a file and the record beside it', async () => {
    const doomed = 'clients/c1/documents/doomed.pdf';
    await storage.put(doomed, body, { contentType: 'application/pdf' });
    await storage.delete(doomed);

    expect(await storage.head(doomed)).toBeNull();
    await expect(readFile(join(root, `${doomed}.meta.json`))).rejects.toThrow();
  });
});

describe('links that expire', () => {
  const signingKey = randomBytes(32).toString('hex');
  let root: string;
  let storage: LocalFileStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'amc-links-'));
    storage = new LocalFileStorage(root, signingKey);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('signs a link that verifies', async () => {
    const url = await storage.presignGet('clients/c1/documents/d1.pdf', { expiresInSeconds: 300 });
    const query = new URLSearchParams(url.split('?')[1]);

    expect(
      storage.verify(
        'clients/c1/documents/d1.pdf',
        query.get('expires') ?? '',
        query.get('signature') ?? '',
      ),
    ).toBe(true);
  });

  it('stops working once it has expired', async () => {
    const url = await storage.presignGet('clients/c1/documents/d1.pdf', { expiresInSeconds: 60 });
    const query = new URLSearchParams(url.split('?')[1]);

    const later = new Date(Date.now() + 61_000);
    expect(
      storage.verify(
        'clients/c1/documents/d1.pdf',
        query.get('expires') ?? '',
        query.get('signature') ?? '',
        later,
      ),
    ).toBe(false);
  });

  it('will not let a link for one file open another', async () => {
    const url = await storage.presignGet('clients/c1/documents/mine.pdf', {
      expiresInSeconds: 300,
    });
    const query = new URLSearchParams(url.split('?')[1]);

    // The signature covers the key, so swapping it invalidates the link.
    expect(
      storage.verify(
        'clients/c2/documents/theirs.pdf',
        query.get('expires') ?? '',
        query.get('signature') ?? '',
      ),
    ).toBe(false);
  });

  it('will not accept an extended expiry, which is the obvious thing to try', async () => {
    const url = await storage.presignGet('clients/c1/documents/d1.pdf', { expiresInSeconds: 60 });
    const query = new URLSearchParams(url.split('?')[1]);
    const stretched = String(Number(query.get('expires')) + 86_400);

    expect(
      storage.verify('clients/c1/documents/d1.pdf', stretched, query.get('signature') ?? ''),
    ).toBe(false);
  });

  it('refuses rubbish without throwing', () => {
    expect(storage.verify('k', 'not-a-number', 'abc')).toBe(false);
    expect(storage.verify('k', '', '')).toBe(false);
  });

  it('carries the download name, so a file saves as the person expects', async () => {
    const url = await storage.presignGet('clients/c1/documents/d1.pdf', {
      expiresInSeconds: 300,
      downloadName: 'Trade Licence.pdf',
    });
    expect(new URLSearchParams(url.split('?')[1]).get('name')).toBe('Trade Licence.pdf');
  });
});
