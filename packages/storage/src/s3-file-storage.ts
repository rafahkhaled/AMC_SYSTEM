import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FileNotFound,
  type FileStorage,
  FileTooLarge,
  type PresignOptions,
  type PutOptions,
  type StoredFile,
} from './file-storage.js';

/**
 * S3, in me-central-1 (ADR-0005).
 *
 * Server-side encryption is required on every write rather than left to a
 * bucket policy, so a misconfigured bucket cannot quietly store client tax
 * documents in the clear. The checksum travels as metadata, because the ETag
 * is not a content hash once a file is uploaded in parts.
 */
export class S3FileStorage implements FileStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly options: {
      /** KMS key id. Omitted means SSE-S3, which is the weaker of the two. */
      kmsKeyId?: string | undefined;
      maxBytes?: number | undefined;
    } = {},
  ) {}

  private get maxBytes(): number {
    return this.options.maxBytes ?? 25 * 1024 * 1024;
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<StoredFile> {
    if (body.byteLength > this.maxBytes) throw new FileTooLarge(body.byteLength, this.maxBytes);

    const checksum = createHash('sha256').update(body).digest('hex');
    const storedAt = new Date();

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(this.options.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.options.kmsKeyId }
          : { ServerSideEncryption: 'AES256' }),
        Metadata: {
          checksum,
          storedat: storedAt.toISOString(),
          ...(options.originalName
            ? { originalname: encodeURIComponent(options.originalName) }
            : {}),
          ...(options.metadata ?? {}),
        },
      }),
    );

    return {
      key,
      size: body.byteLength,
      contentType: options.contentType,
      checksum,
      storedAt,
      originalName: options.originalName,
    };
  }

  async head(key: string): Promise<StoredFile | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        checksum: response.Metadata?.checksum ?? '',
        storedAt: response.LastModified ?? new Date(),
        originalName: response.Metadata?.originalname
          ? decodeURIComponent(response.Metadata.originalname)
          : undefined,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async get(key: string): Promise<{ body: Readable; file: StoredFile }> {
    const file = await this.head(key);
    if (!file) throw new FileNotFound(key);

    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { body: response.Body as Readable, file };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async presignGet(key: string, options: PresignOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.downloadName
          ? {
              ResponseContentDisposition: `attachment; filename="${options.downloadName.replace(/"/g, '')}"`,
            }
          : {}),
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
