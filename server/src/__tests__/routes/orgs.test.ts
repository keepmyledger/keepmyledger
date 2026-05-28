/**
 * Integration tests for the orgs, businesses, and invites routes.
 *
 * Uses a minimal Express app with in-memory SQLite and pre-injected ctx
 * (no real auth middleware).
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { buildContext } from '../../auth/context';
import { orgsRouter } from '../../routes/orgs';
import invitesRouter from '../../routes/invites';
import type { Storage } from '../../services/storage/Storage';

function makeOwnerApp(h: TestDb, storage?: Storage): Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId, 'owner');
    next();
  });
  app.use('/orgs', orgsRouter({ storage }));
  app.use('/orgs/:orgId/invites', invitesRouter);
  return app;
}

function makeMemberApp(h: TestDb, storage?: Storage): Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.altId, h.altOrgId, h.altBusinessId, 'member');
    next();
  });
  app.use('/orgs', orgsRouter({ storage }));
  app.use('/orgs/:orgId/invites', invitesRouter);
  return app;
}

// ── Orgs ─────────────────────────────────────────────────────────────────────

describe('GET /orgs', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => { h = await makeTestDb(); app = makeOwnerApp(h); });
  afterEach(() => h.close());

  it('returns the list of orgs for the current user', async () => {
    const res = await request(app).get('/orgs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((o: { id: string }) => o.id === h.ownerOrgId)).toBe(true);
  });
});

describe('POST /orgs', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => { h = await makeTestDb(); app = makeOwnerApp(h); });
  afterEach(() => h.close());

  it('creates a new org and returns 201', async () => {
    const res = await request(app).post('/orgs').send({ name: 'My Startup' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('My Startup');
    expect(res.body.id).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/orgs').send({});
    expect(res.status).toBe(400);
  });
});

// ── Members ───────────────────────────────────────────────────────────────────

describe('GET /orgs/:orgId/members', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => { h = await makeTestDb(); app = makeOwnerApp(h); });
  afterEach(() => h.close());

  it('returns members of the org', async () => {
    const res = await request(app).get(`/orgs/${h.ownerOrgId}/members`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((m: { userId: string }) => m.userId === h.ownerId)).toBe(true);
  });
});

describe('DELETE /orgs/:orgId/members/:userId', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app).delete(`/orgs/${h.altOrgId}/members/${h.ownerId}`);
    expect(res.status).toBe(403);
  });

  it('removes a member when called by an owner', async () => {
    const app = makeOwnerApp(h);
    // First add alt to owner's org
    await h.owner.org.addMember(h.ownerOrgId, h.altId, 'member');
    const res = await request(app).delete(`/orgs/${h.ownerOrgId}/members/${h.altId}`);
    expect(res.status).toBe(204);
    // Verify removal
    const members = await h.owner.org.listMembers(h.ownerOrgId);
    expect(members.some((m) => m.userId === h.altId)).toBe(false);
  });
});

// ── Businesses ────────────────────────────────────────────────────────────────

describe('GET /orgs/:orgId/businesses', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => { h = await makeTestDb(); app = makeOwnerApp(h); });
  afterEach(() => h.close());

  it('returns businesses for the active org', async () => {
    const res = await request(app).get(`/orgs/${h.ownerOrgId}/businesses`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((b: { id: number }) => b.id === h.ownerBusinessId)).toBe(true);
  });
});

describe('POST /orgs/:orgId/businesses', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('creates a business for an owner', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses`)
      .send({ name: 'New Biz' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Biz');
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app)
      .post(`/orgs/${h.altOrgId}/businesses`)
      .send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app).post(`/orgs/${h.ownerOrgId}/businesses`).send({});
    expect(res.status).toBe(400);
  });
});

describe('PATCH /orgs/:orgId/businesses/:businessId', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('renames a business', async () => {
    const app = makeOwnerApp(h);
    const biz = await h.owner.businesses.create('Before');
    const res = await request(app)
      .patch(`/orgs/${h.ownerOrgId}/businesses/${biz.id}`)
      .send({ name: 'After' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('After');
  });

  it('returns 404 for an unknown business', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app)
      .patch(`/orgs/${h.ownerOrgId}/businesses/99999`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app)
      .patch(`/orgs/${h.altOrgId}/businesses/${h.altBusinessId}`)
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /orgs/:orgId/businesses/:businessId', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('deletes a business', async () => {
    const app = makeOwnerApp(h);
    const biz = await h.owner.businesses.create('Temp');
    const res = await request(app).delete(`/orgs/${h.ownerOrgId}/businesses/${biz.id}`);
    expect(res.status).toBe(204);
    expect(await h.owner.businesses.findById(biz.id)).toBeUndefined();
  });

  it('returns 404 for an unknown business', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app).delete(`/orgs/${h.ownerOrgId}/businesses/99999`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app).delete(`/orgs/${h.altOrgId}/businesses/${h.altBusinessId}`);
    expect(res.status).toBe(403);
  });
});

// ── Business logo ─────────────────────────────────────────────────────────────

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * In-memory Storage stub for logo route tests — captures the most recent
 * put() and supports getSignedUrl() + delete() with no I/O.
 */
function fakeStorage(): Storage & { lastPut: { key: string; contentType: string } | null; deletes: string[] } {
  const state: { lastPut: { key: string; contentType: string } | null; deletes: string[] } = {
    lastPut: null,
    deletes: [],
  };
  return Object.assign(state, {
    put: async (key: string, _body: Buffer, contentType: string) => {
      state.lastPut = { key, contentType };
    },
    getStream: async () => { throw new Error('not used in test'); },
    getBytes: async () => Buffer.alloc(0),
    getSignedUrl: async (key: string) => `https://signed.example/${key}`,
    delete: async (key: string) => { state.deletes.push(key); },
  });
}

describe('POST /orgs/:orgId/businesses/:businessId/logo', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('uploads a PNG, stores it, and persists logo metadata on the business row', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    const res = await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.logoStorageKey).toBeTruthy();
    expect(res.body.logoContentType).toBe('image/png');
    expect(storage.lastPut?.contentType).toBe('image/png');
    expect(storage.lastPut?.key).toMatch(new RegExp(`^logos/${h.ownerBusinessId}/.*\\.png$`));

    const biz = await h.owner.businesses.findById(h.ownerBusinessId);
    expect(biz?.logoStorageKey).toBeTruthy();
    expect(biz?.logoContentType).toBe('image/png');
  });

  it('replaces an existing logo and deletes the old object', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    const firstKey = storage.lastPut?.key;
    await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo2.png', contentType: 'image/png' });
    // Wait a tick so the best-effort delete fires (it's fire-and-forget).
    await new Promise((r) => setImmediate(r));
    expect(storage.deletes).toContain(firstKey);
  });

  it('rejects PDF with 422', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    const res = await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', Buffer.from('%PDF-1.4\n'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
  });

  it('returns 503 when storage is not configured', async () => {
    const app = makeOwnerApp(h); // no storage
    const res = await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
  });

  it('returns 403 for a non-owner', async () => {
    const storage = fakeStorage();
    const app = makeMemberApp(h, storage);
    const res = await request(app)
      .post(`/orgs/${h.altOrgId}/businesses/${h.altBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });
});

describe('GET /orgs/:orgId/businesses/:businessId/logo', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('redirects to a signed URL when the business has a logo', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    const res = await request(app)
      .get(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/signed\.example\//);
  });

  it('returns 404 when no logo is set', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    const res = await request(app).get(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /orgs/:orgId/businesses/:businessId/logo', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('clears the logo columns and deletes the underlying object', async () => {
    const storage = fakeStorage();
    const app = makeOwnerApp(h, storage);
    await request(app)
      .post(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`)
      .attach('file', PNG_HEADER, { filename: 'logo.png', contentType: 'image/png' });
    const uploadedKey = storage.lastPut?.key;

    const res = await request(app).delete(`/orgs/${h.ownerOrgId}/businesses/${h.ownerBusinessId}/logo`);
    expect(res.status).toBe(204);

    const biz = await h.owner.businesses.findById(h.ownerBusinessId);
    expect(biz?.logoStorageKey).toBeNull();
    expect(biz?.logoContentType).toBeNull();

    await new Promise((r) => setImmediate(r));
    expect(storage.deletes).toContain(uploadedKey);
  });

  it('returns 403 for a non-owner', async () => {
    const storage = fakeStorage();
    const app = makeMemberApp(h, storage);
    const res = await request(app).delete(`/orgs/${h.altOrgId}/businesses/${h.altBusinessId}/logo`);
    expect(res.status).toBe(403);
  });
});

// ── Invites ───────────────────────────────────────────────────────────────────

describe('GET /orgs/:orgId/invites', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('returns pending invites for an owner', async () => {
    const app = makeOwnerApp(h);
    await h.owner.invites.create({ email: 'pending@example.com' });
    const res = await request(app).get(`/orgs/${h.ownerOrgId}/invites`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((i: { email: string }) => i.email === 'pending@example.com')).toBe(true);
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app).get(`/orgs/${h.altOrgId}/invites`);
    expect(res.status).toBe(403);
  });
});

describe('POST /orgs/:orgId/invites', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('creates an invite for an owner', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app)
      .post(`/orgs/${h.ownerOrgId}/invites`)
      .send({ email: 'new@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@example.com');
    expect(res.body.status).toBe('pending');
  });

  it('returns 400 when email is missing', async () => {
    const app = makeOwnerApp(h);
    const res = await request(app).post(`/orgs/${h.ownerOrgId}/invites`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app)
      .post(`/orgs/${h.altOrgId}/invites`)
      .send({ email: 'nope@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /orgs/:orgId/invites/:inviteId', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('expires an invite and returns 204', async () => {
    const app = makeOwnerApp(h);
    const invite = await h.owner.invites.create({ email: 'expire@example.com' });
    const res = await request(app).delete(`/orgs/${h.ownerOrgId}/invites/${invite.id}`);
    expect(res.status).toBe(204);
    const found = await h.owner.invites.findByToken(invite.id);
    expect(found?.status).toBe('expired');
  });

  it('returns 403 for a non-owner', async () => {
    const app = makeMemberApp(h);
    const res = await request(app).delete(`/orgs/${h.altOrgId}/invites/fake-token`);
    expect(res.status).toBe(403);
  });
});
