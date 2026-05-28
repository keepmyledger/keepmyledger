import type { Readable } from 'stream';

/**
 * Object storage abstraction. One bucket per deployment; callers namespace
 * keys by purpose (e.g. `receipts/{businessId}/{uuid}.{ext}`,
 * `logos/{businessId}/{uuid}.{ext}`).
 *
 * Implementations: `S3Storage` (AWS S3, MinIO, R2, Backblaze, Wasabi via
 * `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE`).
 */
export interface Storage {
  /** Upload bytes at `key` with the given Content-Type. Overwrites if exists. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Open a read stream for `key`. Throws if the object does not exist. */
  getStream(key: string): Promise<Readable>;

  /** Download the entire object as a Buffer. For small assets (logos, etc). */
  getBytes(key: string): Promise<Buffer>;

  /** Return a pre-signed GET URL valid for `ttlSec` seconds. */
  getSignedUrl(key: string, ttlSec: number): Promise<string>;

  /** Delete the object at `key`. Idempotent: succeeds if already absent. */
  delete(key: string): Promise<void>;
}
