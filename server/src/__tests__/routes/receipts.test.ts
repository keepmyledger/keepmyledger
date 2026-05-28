/**
 * Receipts route integration tests — exercises the S3 upload/download/delete
 * flow with a fake `Storage` stub. Avoids any real AWS/MinIO dependency.
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Readable } from 'stream';
import { makeTestDb, TestDb } from '../helpers/db';
import { buildContext, getUserRepo } from '../../auth/context';
import { receiptsRouter } from '../../routes/receipts';
import type { DriveService } from '../../services/driveService';
import type { Storage } from '../../services/storage/Storage';

class FakeStorage implements Storage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  signedCalls: Array<{ key: string; ttl: number }> = [];

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  async getBytes(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`missing ${key}`);
    return o.body;
  }
  async getStream(key: string): Promise<Readable> {
    const buf = await this.getBytes(key);
    return Readable.from(buf);
  }
  async getSignedUrl(key: string, ttlSec: number): Promise<string> {
    this.signedCalls.push({ key, ttl: ttlSec });
    return `https://fake.example/${encodeURIComponent(key)}?ttl=${ttlSec}`;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);

function makeApp(h: TestDb, storage: Storage): Application {
  // Minimal DriveService stub: `isAuthenticated → false` so a drive-path
  // request lands on the 401 branch rather than throwing through the catch-all.
  const drive = {
    isAuthenticated: async () => false,
  } as unknown as DriveService;
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId);
    next();
  });
  app.use('/receipts', receiptsRouter({ db: h.db, drive, storage }));
  return app;
}

describe('receipts route — S3 backend (user prefers kml)', () => {
  let h: TestDb;
  let storage: FakeStorage;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    storage = new FakeStorage();
    // Opt the owner into KML storage. Equivalent to clicking the radio in Settings.
    await getUserRepo(h.db).setReceiptStoragePreference(h.ownerId, 'kml');
    app = makeApp(h, storage);
  });

  afterEach(async () => {
    await h.close();
  });

  it('POST /receipts/upload stores a PDF in S3 and persists the row', async () => {
    const res = await request(app)
      .post('/receipts/upload')
      .attach('file', PDF, { filename: 'r.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.storageBackend).toBe('s3');
    expect(res.body.storageKey).toMatch(/^receipts\/\d+\/[0-9a-f-]+\.pdf$/);
    expect(res.body.contentType).toBe('application/pdf');
    expect(res.body.driveFileId).toBeNull();

    expect(storage.objects.size).toBe(1);
    const [key, obj] = [...storage.objects.entries()][0];
    expect(key).toBe(res.body.storageKey);
    expect(obj.contentType).toBe('application/pdf');
    expect(obj.body.equals(PDF)).toBe(true);
  });

  it('POST /receipts/upload rejects an unsupported file type before writing to storage', async () => {
    const res = await request(app)
      .post('/receipts/upload')
      .attach('file', Buffer.from('hello world'), { filename: 'r.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported file type/i);
    expect(storage.objects.size).toBe(0);
  });

  it('POST /receipts/upload rejects a renamed binary whose magic bytes do not match the mime', async () => {
    const res = await request(app)
      .post('/receipts/upload')
      .attach('file', PDF, { filename: 'fake.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/i);
    expect(storage.objects.size).toBe(0);
  });

  it('GET /receipts/:id/download redirects to a signed URL', async () => {
    const created = await request(app)
      .post('/receipts/upload')
      .attach('file', PDF, { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(created.status).toBe(201);

    const res = await request(app).get(`/receipts/${created.body.id}/download`);
    expect(res.status).toBe(302);
    expect(res.header.location).toMatch(/^https:\/\/fake\.example\//);
    expect(storage.signedCalls).toHaveLength(1);
    expect(storage.signedCalls[0].ttl).toBe(10 * 60);
    expect(storage.signedCalls[0].key).toBe(created.body.storageKey);
  });

  it('GET /receipts/:id/download 400s for a drive-backed receipt', async () => {
    const driveOnly = await h.owner.receipts.create({
      driveFileId: 'd-1', driveFileName: 'x.pdf', driveMimeType: null,
      driveWebViewLink: null, driveThumbnailLink: null,
    });
    const res = await request(app).get(`/receipts/${driveOnly.id}/download`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not S3-backed/i);
  });

  it('DELETE /receipts/:id removes the S3 object and the DB row', async () => {
    const created = await request(app)
      .post('/receipts/upload')
      .attach('file', PDF, { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(storage.objects.size).toBe(1);

    const del = await request(app).delete(`/receipts/${created.body.id}`);
    expect(del.status).toBe(204);
    expect(storage.objects.size).toBe(0);
    expect(await h.owner.receipts.findById(created.body.id)).toBeUndefined();
  });

  it('falls back to drive when user preference is drive (even if KML is configured)', async () => {
    await getUserRepo(h.db).setReceiptStoragePreference(h.ownerId, 'drive');
    const res = await request(app)
      .post('/receipts/upload')
      .attach('file', PDF, { filename: 'r.pdf', contentType: 'application/pdf' });
    // The fake drive isn't wired, so this hits the 401 'not authenticated with Google Drive'
    // branch — proof that the s3 path was *not* taken.
    expect(res.status).toBe(401);
    expect(storage.objects.size).toBe(0);
  });

  it('POST /receipts/upload links to a transaction when transactionId is provided', async () => {
    const acct = await h.owner.accounts.create({ name: 'A', bankType: 'mt', accountKind: 'checking' });
    const stmt = await h.owner.statements.create({
      accountId: acct.id, period: '2026-01', sourcePdfPath: '/x.pdf', parserUsed: 'template',
    });
    await h.owner.transactions.bulkCreate([{
      accountId: acct.id, statementId: stmt.id, date: '2026-01-15',
      description: 'TEST', amount: -10, categoryId: null, categorySource: null,
      suggestedCategoryId: null, ruleId: null, notes: null,
      taxDescription: null, externalHash: 'h-link',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any]);
    const tx = (await h.owner.transactions.findAll())[0];

    const res = await request(app)
      .post('/receipts/upload')
      .field('transactionId', String(tx.id))
      .attach('file', PDF, { filename: 'r.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    const linked = await h.owner.receipts.findByTransactionId(tx.id);
    expect(linked.map((r) => r.id)).toEqual([res.body.id]);
  });
});
