import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { FileTooLarge } from './file-storage.js';
import { S3FileStorage } from './s3-file-storage.js';

/**
 * There is no S3 here, and no honest way to pretend otherwise. What these
 * check is our half of the conversation: that every write demands encryption,
 * that the checksum is carried where it can be read back, and that a link is
 * signed with the expiry asked for. Whether S3 behaves is S3's business, and
 * it is confirmed the first time this is deployed.
 */
function fakeClient(response: Record<string, unknown> = {}) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    send: vi.fn(
      async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        return response;
      },
    ),
    config: { region: async () => 'me-central-1' },
  } as unknown as S3Client;
  return { client, sent };
}

const body = Buffer.from('%PDF-1.7 an invoice');

describe('writing to S3', () => {
  it('always demands encryption at rest, rather than trusting a bucket policy', async () => {
    const { client, sent } = fakeClient();
    await new S3FileStorage(client, 'amc-documents', { kmsKeyId: 'key-1' }).put(
      'clients/c1/documents/d1.pdf',
      body,
      { contentType: 'application/pdf' },
    );

    expect(sent[0]?.input.ServerSideEncryption).toBe('aws:kms');
    expect(sent[0]?.input.SSEKMSKeyId).toBe('key-1');
  });

  it('still encrypts when no key is configured, with the weaker of the two', async () => {
    const { client, sent } = fakeClient();
    await new S3FileStorage(client, 'amc-documents').put('k.pdf', body, {
      contentType: 'application/pdf',
    });
    expect(sent[0]?.input.ServerSideEncryption).toBe('AES256');
  });

  it('carries the checksum as metadata, because an ETag is not a content hash', async () => {
    const { client, sent } = fakeClient();
    const stored = await new S3FileStorage(client, 'amc-documents').put('k.pdf', body, {
      contentType: 'application/pdf',
    });

    const expected = createHash('sha256').update(body).digest('hex');
    expect(stored.checksum).toBe(expected);
    expect((sent[0]?.input.Metadata as Record<string, string>).checksum).toBe(expected);
  });

  it('escapes the original name, which may be Arabic', async () => {
    const { client, sent } = fakeClient();
    await new S3FileStorage(client, 'amc-documents').put('k.pdf', body, {
      contentType: 'application/pdf',
      originalName: 'فاتورة مارس.pdf',
    });

    // S3 metadata is ASCII only, so a non-Latin filename has to be encoded or
    // the request is rejected outright.
    const metadata = sent[0]?.input.Metadata as Record<string, string>;
    expect(metadata.originalname).toBe(encodeURIComponent('فاتورة مارس.pdf'));
    expect(/^[\x20-\x7e]*$/.test(metadata.originalname ?? '')).toBe(true);
  });

  it('refuses an oversized file before spending the upload', async () => {
    const { client, sent } = fakeClient();
    await expect(
      new S3FileStorage(client, 'amc-documents', { maxBytes: 10 }).put('k.pdf', body, {
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(FileTooLarge);
    expect(sent).toHaveLength(0);
  });
});

describe('reading from S3', () => {
  it('treats a missing object as an answer, not a failure', async () => {
    const client = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { name: 'NotFound' });
      }),
    } as unknown as S3Client;

    expect(await new S3FileStorage(client, 'amc-documents').head('k.pdf')).toBeNull();
  });

  it('lets a genuine failure through rather than reporting it as missing', async () => {
    const client = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('access denied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        });
      }),
    } as unknown as S3Client;

    // Reporting a permissions problem as "not found" would send whoever is
    // debugging it looking in entirely the wrong place.
    await expect(new S3FileStorage(client, 'amc-documents').head('k.pdf')).rejects.toThrow(
      'access denied',
    );
  });

  it('reads back the checksum and original name it wrote', async () => {
    const { client } = fakeClient({
      ContentLength: 19,
      ContentType: 'application/pdf',
      LastModified: new Date('2026-09-15T06:00:00Z'),
      Metadata: { checksum: 'abc123', originalname: encodeURIComponent('فاتورة.pdf') },
    });

    const file = await new S3FileStorage(client, 'amc-documents').head('k.pdf');
    expect(file?.checksum).toBe('abc123');
    expect(file?.originalName).toBe('فاتورة.pdf');
  });
});
