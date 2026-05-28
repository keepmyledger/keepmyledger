import { S3Storage } from '../../../services/storage/S3Storage';
import { PutObjectCommand, type ServerSideEncryption } from '@aws-sdk/client-s3';

// ── Unit test: SSE header is set on every PutObject ──────────────────────────
// Inspects the client's middleware stack so we don't need a live S3.

describe('S3Storage SSE configuration', () => {
  function captureSse(opts: ConstructorParameters<typeof S3Storage>[0]): Promise<{
    sse: ServerSideEncryption | undefined;
    kmsKeyId: string | undefined;
  }> {
    const storage = new S3Storage(opts);
    // Reach into the internal client to add a one-shot middleware that captures
    // the PutObject input, then short-circuits the request.
    const client = (storage as unknown as { client: { middlewareStack: { add: Function } } }).client;
    return new Promise((resolve, reject) => {
      client.middlewareStack.add(
        (next: (args: { input: unknown }) => Promise<unknown>) =>
          async (args: { input: unknown }) => {
            if (args.input instanceof PutObjectCommand || (args.input as { Bucket?: string }).Bucket) {
              const input = args.input as { ServerSideEncryption?: ServerSideEncryption; SSEKMSKeyId?: string };
              resolve({ sse: input.ServerSideEncryption, kmsKeyId: input.SSEKMSKeyId });
              // Throw to short-circuit; the storage.put() promise will reject and we ignore it.
              throw new Error('short-circuit');
            }
            return next(args);
          },
        { step: 'initialize', name: 'capture-sse-test', priority: 'high' },
      );
      void storage.put('test-key', Buffer.from('x'), 'application/octet-stream').catch(reject);
    });
  }

  it('uses SSE-S3 (AES256) when no KMS key configured', async () => {
    const { sse, kmsKeyId } = await captureSse({
      bucket: 'test-bucket',
      region: 'us-east-1',
    });
    expect(sse).toBe('AES256');
    expect(kmsKeyId).toBeUndefined();
  });

  it('uses SSE-KMS when kmsKeyId is configured', async () => {
    const { sse, kmsKeyId } = await captureSse({
      bucket: 'test-bucket',
      region: 'us-east-1',
      kmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/abc-123',
    });
    expect(sse).toBe('aws:kms');
    expect(kmsKeyId).toBe('arn:aws:kms:us-east-1:123456789012:key/abc-123');
  });
});

/**
 * Round-trip integration test against MinIO (or any S3-compatible target).
 *
 * Gated on TEST_S3_ENDPOINT so CI without MinIO doesn't fail. To run locally:
 *
 *   docker compose up -d minio minio-init
 *   TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
 *   TEST_S3_BUCKET=keepmyledger \
 *   TEST_S3_ACCESS_KEY_ID=kml \
 *   TEST_S3_SECRET_ACCESS_KEY=kmlsecret \
 *   npm test -w server -- S3Storage
 */
const endpoint = process.env.TEST_S3_ENDPOINT;
const bucket = process.env.TEST_S3_BUCKET;
const accessKeyId = process.env.TEST_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.TEST_S3_SECRET_ACCESS_KEY;

const describeS3 = endpoint && bucket && accessKeyId && secretAccessKey ? describe : describe.skip;

describeS3('S3Storage (MinIO)', () => {
  const storage = new S3Storage({
    bucket: bucket!,
    region: 'us-east-1',
    endpoint: endpoint!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle: true,
  });

  const testKey = `test/storage-roundtrip-${Date.now()}.bin`;
  const payload = Buffer.from('keepmyledger storage round-trip');

  afterAll(async () => {
    try { await storage.delete(testKey); } catch { /* best effort */ }
  });

  it('put → getBytes round-trips identical bytes', async () => {
    await storage.put(testKey, payload, 'application/octet-stream');
    const out = await storage.getBytes(testKey);
    expect(out.equals(payload)).toBe(true);
  });

  it('getSignedUrl returns a usable URL', async () => {
    const url = await storage.getSignedUrl(testKey, 60);
    expect(url).toMatch(/^https?:\/\//);
    const resp = await fetch(url);
    expect(resp.status).toBe(200);
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body.equals(payload)).toBe(true);
  });

  it('delete is idempotent', async () => {
    await storage.delete(testKey);
    await expect(storage.delete(testKey)).resolves.toBeUndefined();
  });
});
