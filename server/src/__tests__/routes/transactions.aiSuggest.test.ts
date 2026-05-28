/**
 * POST /transactions/:id/ai-suggest route tests (issue #46).
 *
 * Tests the AI categorization endpoint including subscription gating,
 * daily quota enforcement, and happy-path suggestion flow.
 * The LLM client is mocked — no real API calls are made.
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { transactionsRouter } from '../../routes/transactions';
import { buildContext } from '../../auth/context';
import { hashTransaction } from '../../parsers/utils';

// Mock the LLM client so no real API calls are made
jest.mock('../../llm/client', () => ({
  isLlmConfigured: jest.fn(() => true),
  chatJson: jest.fn(),
}));

import { chatJson, isLlmConfigured } from '../../llm/client';
const mockChatJson = chatJson as jest.MockedFunction<typeof chatJson>;
const mockIsLlmConfigured = isLlmConfigured as jest.MockedFunction<typeof isLlmConfigured>;

// ── helpers ──────────────────────────────────────────────────────────────────

function makeApp(h: TestDb, appMode = 'selfhost'): Application {
  process.env.APP_MODE = appMode;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId);
    next();
  });
  app.use('/transactions', transactionsRouter());
  return app;
}

async function seedTransaction(
  h: TestDb,
  description = 'WHOLE FOODS',
  amount = -42.5,
): Promise<number> {
  const acct = await h.owner.accounts.create({
    name: 'Checking',
    bankType: 'mt',
    accountKind: 'checking',
  });
  const stmt = await h.owner.statements.create({
    accountId: acct.id,
    period: '2026-01',
    sourcePdfPath: '/tmp/test.pdf',
    parserUsed: 'template',
  });
  await h.owner.transactions.bulkCreate([
    {
      accountId: acct.id,
      statementId: stmt.id,
      date: '2026-01-10',
      description,
      amount,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: hashTransaction(acct.id, '2026-01-10', description, amount),
    } as never,
  ]);
  const [tx] = await h.owner.transactions.findAll();
  return tx.id;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /transactions/:id/ai-suggest', () => {
  let h: TestDb;
  const ORIGINAL_APP_MODE = process.env.APP_MODE;
  const ORIGINAL_STRIPE = process.env.STRIPE_SECRET_KEY;

  beforeEach(async () => {
    h = await makeTestDb();
    mockIsLlmConfigured.mockReturnValue(true);
    mockChatJson.mockReset();
    // Ensure Stripe is considered configured so saas-mode paywall actually
    // gates (dark-launch bypass only kicks in when Stripe is NOT configured).
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  });

  afterEach(async () => {
    await h.close();
    if (ORIGINAL_APP_MODE === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = ORIGINAL_APP_MODE;
    if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE;
    delete process.env.AI_DAILY_LIMIT;
  });

  // ── LLM availability ──────────────────────────────────────────────────────

  it('returns 503 when LLM is not configured', async () => {
    mockIsLlmConfigured.mockReturnValue(false);
    const app = makeApp(h);
    const txId = await seedTransaction(h);

    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/LLM_API_KEY/i);
  });

  // ── Subscription gating ───────────────────────────────────────────────────

  it('returns 402 when subscription is canceled (saas mode)', async () => {
    const app = makeApp(h, 'saas');
    const txId = await seedTransaction(h);

    // Override the subscription to canceled
    await h.owner.subscription.update({ status: 'canceled' });

    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_required');
  });

  it('allows request in saas mode with active subscription', async () => {
    const app = makeApp(h, 'saas');
    const txId = await seedTransaction(h);
    const cats = await h.owner.categories.findAll();

    await h.owner.subscription.create({ status: 'active', plan: 'monthly', trialEndsAt: null });

    mockChatJson.mockResolvedValue({
      categoryId: cats[0].id,
      confidence: 0.9,
      taxDescription: null,
      rationale: null,
      proposedRule: null,
    });

    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);
    expect(res.status).toBe(200);
  });

  // ── Transaction not found ─────────────────────────────────────────────────

  it('returns 404 for an unknown transaction id', async () => {
    const app = makeApp(h);
    const res = await request(app).post('/transactions/999999/ai-suggest');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns suggestion with categoryId, confidence, and categoryName', async () => {
    const app = makeApp(h);
    const txId = await seedTransaction(h);
    const cats = await h.owner.categories.findAll();
    const cat = cats[0];

    mockChatJson.mockResolvedValue({
      categoryId: cat.id,
      confidence: 0.95,
      taxDescription: 'Groceries for office event',
      rationale: 'Whole Foods is a grocery store.',
      proposedRule: null,
    });

    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(cat.id);
    expect(res.body.categoryName).toBe(cat.name);
    expect(res.body.confidence).toBeCloseTo(0.95);
    expect(res.body.taxDescription).toBe('Groceries for office event');
  });

  it('returns null categoryId when LLM hallucinates an unknown category', async () => {
    const app = makeApp(h);
    const txId = await seedTransaction(h);

    mockChatJson.mockResolvedValue({
      categoryId: 99999,
      confidence: 0.9,
      taxDescription: null,
      rationale: null,
      proposedRule: null,
    });

    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBeNull();
  });

  // ── Daily quota ───────────────────────────────────────────────────────────

  it('returns 429 when daily quota is reached', async () => {
    process.env.AI_DAILY_LIMIT = '2';
    const app = makeApp(h);
    const txId = await seedTransaction(h);
    const cats = await h.owner.categories.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: cats[0].id,
      confidence: 0.9,
      taxDescription: null,
      rationale: null,
      proposedRule: null,
    });

    // Exhaust the quota
    await request(app).post(`/transactions/${txId}/ai-suggest`);
    await request(app).post(`/transactions/${txId}/ai-suggest`);

    // Third call should be blocked
    const res = await request(app).post(`/transactions/${txId}/ai-suggest`);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/limit/i);
    expect(res.body.limit).toBe(2);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('increments quota counter on successful call', async () => {
    process.env.AI_DAILY_LIMIT = '5';
    const app = makeApp(h);
    const txId = await seedTransaction(h);
    const cats = await h.owner.categories.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: cats[0].id,
      confidence: 0.9,
      taxDescription: null,
      rationale: null,
      proposedRule: null,
    });

    await request(app).post(`/transactions/${txId}/ai-suggest`);

    const used = await h.owner.aiUsage.getTodayCount();
    expect(used).toBe(1);
  });

  it('does NOT increment quota on LLM failure (404)', async () => {
    process.env.AI_DAILY_LIMIT = '5';
    const app = makeApp(h);

    // Non-existent transaction — service throws before LLM call
    await request(app).post('/transactions/999999/ai-suggest');

    const used = await h.owner.aiUsage.getTodayCount();
    expect(used).toBe(0);
  });

  // ── Tier quota (saas mode) ────────────────────────────────────────────────

  describe('tier-based AI quota (saas mode)', () => {
    beforeEach(() => {
      // Ensure Stripe appears configured so requireActiveSubscription
      // doesn't dark-launch bypass and actually enforces the subscription gate.
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    });
    afterEach(() => {
      delete process.env.STRIPE_SECRET_KEY;
    });

    it('free tier is blocked after 5 lifetime AI calls (upgrade_required)', async () => {
      const app = makeApp(h, 'saas');
      const txId = await seedTransaction(h);
      const cats = await h.owner.categories.findAll();

      // Ensure owner has an active free-tier subscription row. provisionDefaults
      // only inserts it when APP_MODE=saas, but makeTestDb runs without it.
      await h.owner.subscription.create({ status: 'active', plan: 'beta', trialEndsAt: null });
      await h.owner.subscription.update({ status: 'active', tier: 'free', seats: 1 });

      mockChatJson.mockResolvedValue({
        categoryId: cats[0].id,
        confidence: 0.9,
        taxDescription: null,
        rationale: null,
        proposedRule: null,
      });

      // Burn through the 5 free calls.
      for (let i = 0; i < 5; i++) {
        const ok = await request(app).post(`/transactions/${txId}/ai-suggest`);
        expect(ok.status).toBe(200);
      }
      expect(await h.owner.aiUsage.getLifetimeCount()).toBe(5);

      // 6th call → blocked.
      const blocked = await request(app).post(`/transactions/${txId}/ai-suggest`);
      expect(blocked.status).toBe(429);
      expect(blocked.body.upgradeRequired).toBe(true);
      expect(blocked.body.limit).toBe(5);
    });

    it('business tier (saas) is not lifetime-capped and respects daily quota', async () => {
      const app = makeApp(h, 'saas');
      const txId = await seedTransaction(h);
      const cats = await h.owner.categories.findAll();

      await h.owner.subscription.create({ status: 'active', plan: 'business_monthly', trialEndsAt: null });
      await h.owner.subscription.update({ status: 'active', tier: 'business', seats: 1 });

      mockChatJson.mockResolvedValue({
        categoryId: cats[0].id,
        confidence: 0.9,
        taxDescription: null,
        rationale: null,
        proposedRule: null,
      });

      // Business tier has no lifetime cap — make more than FREE_TIER_AI_LIFETIME_LIMIT (5) calls.
      for (let i = 0; i < 8; i++) {
        const ok = await request(app).post(`/transactions/${txId}/ai-suggest`);
        expect(ok.status).toBe(200);
      }
      // Daily counter IS incremented for business tier (daily quota applies, default 100).
      expect(await h.owner.aiUsage.getTodayCount()).toBe(8);
    });
  });
});
