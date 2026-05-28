/**
 * Integration tests for the admin router.
 *
 * Focuses on the grant-tier / revoke-grant endpoints and the trial-restoration
 * logic added in PR #70 (fix 1).
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { adminRouter } from '../../routes/admin';
import { buildContext } from '../../auth/context';

/**
 * Build a test Express app wired to the admin router.
 * The owner user is promoted to admin via a direct DB write before each test,
 * so requireAdmin passes without needing OAuth / session plumbing.
 */
function makeAdminApp(h: TestDb): Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId);
    req.user = { id: h.ownerId, email: 'admin@test.example' };
    next();
  });
  app.use('/admin', adminRouter(h.db));
  return app;
}

async function makeOwnerAdmin(h: TestDb): Promise<void> {
  await h.db.run('UPDATE users SET is_admin = ? WHERE id = ?', [1, h.ownerId]);
}

describe('adminRouter — grant-tier / revoke-grant', () => {
  let h: TestDb;
  let app: Application;
  const ORIGINAL_APP_MODE = process.env.APP_MODE;

  beforeEach(async () => {
    // Force selfhost so requireUser doesn't call syncAdminStatus (which would
    // strip is_admin from the test owner since their email isn't in ADMIN_EMAILS).
    // Must be set BEFORE makeAdminApp/adminRouter captures the mode.
    process.env.APP_MODE = 'selfhost';
    h = await makeTestDb();
    app = makeAdminApp(h);
    await makeOwnerAdmin(h);
    // Seed alt subscription (provisionDefaults does not create one outside saas mode).
    await h.alt.subscription.create({ status: 'trialing', plan: 'beta', trialEndsAt: null });
  });

  afterEach(async () => {
    await h.close();
    if (ORIGINAL_APP_MODE === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = ORIGINAL_APP_MODE;
  });

  // ── grant-tier ─────────────────────────────────────────────────────────────

  it('POST /grant-tier returns 404 for unknown user', async () => {
    const res = await request(app)
      .post('/admin/users/nonexistent-id/grant-tier')
      .send({ tier: 'business' });
    expect(res.status).toBe(404);
  });

  it('POST /grant-tier returns 400 for invalid tier', async () => {
    const res = await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'free' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier/i);
  });

  it('POST /grant-tier sets status=active and tier on the target user', async () => {
    // alt subscription is pre-seeded by makeTestDb via provisionDefaults

    const res = await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tier).toBe('business');

    const sub = await h.alt.subscription.get();
    expect(sub?.status).toBe('active');
    expect(sub?.plan).toBe('admin_grant');
    expect(sub?.tier).toBe('business');
    expect(sub?.grantedByAdminId).toBe(h.ownerId);
  });

  it('POST /grant-tier preserves trial_ends_at so revoke can restore it', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await h.alt.subscription.update({ status: 'trialing', trialEndsAt: futureDate });

    await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    // trial_ends_at must survive the grant so revoke can check it.
    const sub = await h.alt.subscription.get();
    expect(sub?.trialEndsAt).toBe(futureDate);
  });

  it('POST /grant-tier returns 409 if user already has an active Stripe sub', async () => {
    await h.alt.subscription.update({ status: 'active', stripeSubscriptionId: 'sub_live123' });

    const res = await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    expect(res.status).toBe(409);
  });

  // ── revoke-grant ───────────────────────────────────────────────────────────

  it('revoke restores status=trialing when trial is still in the future', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await h.alt.subscription.update({ status: 'trialing', trialEndsAt: futureDate });

    // Grant
    await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    // Revoke
    const res = await request(app).post(`/admin/users/${h.altId}/revoke-grant`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('trialing');

    const sub = await h.alt.subscription.get();
    expect(sub?.status).toBe('trialing');
    expect(sub?.tier).toBe('free');
    expect(sub?.plan).toBe('revoked');
    expect(sub?.grantedByAdminId).toBeNull();
  });

  it('revoke sets status=canceled when trial has already expired', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await h.alt.subscription.update({ status: 'trialing', trialEndsAt: pastDate });

    // Grant
    await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    // Revoke
    const res = await request(app).post(`/admin/users/${h.altId}/revoke-grant`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');

    const sub = await h.alt.subscription.get();
    expect(sub?.status).toBe('canceled');
    expect(sub?.tier).toBe('free');
  });

  it('revoke sets status=canceled when there was no trial', async () => {
    await h.alt.subscription.update({ trialEndsAt: null });

    await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    const res = await request(app).post(`/admin/users/${h.altId}/revoke-grant`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
  });

  it('revoke returns 400 when subscription was not admin-granted', async () => {
    // Alt sub is pre-seeded with plan != 'admin_grant', so no extra setup needed.

    const res = await request(app).post(`/admin/users/${h.altId}/revoke-grant`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not admin-granted/i);
  });

  it('non-admin receives 403', async () => {
    // Demote the owner so requireAdmin fails
    await h.db.run('UPDATE users SET is_admin = ? WHERE id = ?', [0, h.ownerId]);

    const res = await request(app)
      .post(`/admin/users/${h.altId}/grant-tier`)
      .send({ tier: 'business' });

    expect(res.status).toBe(403);
  });
});
