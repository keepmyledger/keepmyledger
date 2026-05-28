import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import type { Storage } from './Storage';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Required for MinIO and most non-AWS S3 clones. */
  forcePathStyle?: boolean;
  /** If set, uploads use SSE-KMS with this key. Otherwise SSE-S3 (AES256). */
  kmsKeyId?: string;
}

export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId?: string;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.kmsKeyId = opts.kmsKeyId;
    const cfg: S3ClientConfig = {
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
    };
    if (opts.endpoint) cfg.endpoint = opts.endpoint;
    if (opts.accessKeyId && opts.secretAccessKey) {
      cfg.credentials = {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      };
    }
    this.client = new S3Client(cfg);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    // Always request server-side encryption. SSE-KMS when a key is configured
    // (preferred for SaaS: per-object audit via CloudTrail, customer-controlled
    // key rotation, revocable access). SSE-S3 (AES256) otherwise — free, no
    // setup, accepted as a no-op by MinIO and most S3 clones.
    const sse = this.kmsKeyId
      ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: this.kmsKeyId }
      : { ServerSideEncryption: 'AES256' as const };
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...sse,
    }));
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body;
    if (!body) throw new Error(`s3: empty body for ${key}`);
    return body as Readable;
  }

  async getBytes(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }

  async getSignedUrl(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSec },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * Build an S3Storage from env vars. Returns null if S3 is not configured,
 * letting the caller fall back to another backend.
 *
 *   S3_BUCKET             required
 *   S3_REGION             required (use 'us-east-1' for MinIO if unset)
 *   S3_ENDPOINT           optional — set for MinIO / R2 / Backblaze
 *   S3_ACCESS_KEY_ID      optional — falls back to AWS default credential chain
 *   S3_SECRET_ACCESS_KEY  optional — paired with S3_ACCESS_KEY_ID
 *   S3_FORCE_PATH_STYLE   optional — '1' / 'true' enables path-style addressing (MinIO needs this)
 *   S3_KMS_KEY_ID         optional — switches uploads from SSE-S3 to SSE-KMS with this key
 */
export function s3StorageFromEnv(): S3Storage | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || undefined;
  const pathStyle = process.env.S3_FORCE_PATH_STYLE;
  const kmsKeyId = process.env.S3_KMS_KEY_ID || undefined;
  return new S3Storage({
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: pathStyle === '1' || pathStyle === 'true',
    kmsKeyId,
  });
}
