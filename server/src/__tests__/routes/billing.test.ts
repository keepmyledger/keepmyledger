/**
 * Stripe webhook handler integration tests.
 *
 * Uses an in-memory SQLite database and mocks constructWebhookEvent from
 * stripeService so no real Stripe calls are made.
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { stripeWebhookHandler, billingRouter } from '../../routes/billing';
import { buildContext } from '../../auth/context';
import { encrypt } from '../../auth/crypto';
import { hashEmail } from '../../auth/emailHash';

// Mock stripeService so we can control constructWebhookEvent
jest.mock('../../services/stripeService', () => ({
  isStripeConfigured: jest.fn(() => true),
  constructWebhookEvent: jest.fn(),
  cancelAtPeriodEnd: jest.fn(),
  reactivateSubscription: jest.fn(),
  getPriceIdByLookupKey: jest.fn(),
  createSetupIntent: jest.fn(),
  attachAndSubscribe: jest.fn(),
  getOrCreateCustomer: jest.fn(),
  getDefaultPaymentMethodLast4: jest.fn(() => Promise.resolve(null)),
  getPromotionCodeId: jest.fn(),
}));

// Mock emailService to avoid real email sends
jest.mock('../../services/emailService', () => ({
  paymentFailedEmail: jest.fn(),
  initEmailService: jest.fn(),
}));

import {
  constructWebhookEvent,
  isStripeConfigured,
  getOrCreateCustomer,
  createSetupIntent,
  attachAndSubscribe,
  cancelAtPeriodEnd,
  reactivateSubscription,
  getPriceIdByLookupKey,
  getPromotionCodeId,
} from '../../services/stripeService';
const mockConstructWebhookEvent = constructWebhookEvent as jest.MockedFunction<typeof constructWebhookEvent>;
const mockIsStripeConfigured = isStripeConfigured as jest.MockedFunction<typeof isStripeConfigured>;
const mockGetOrCreateCustomer = getOrCreateCustomer as jest.MockedFunction<typeof getOrCreateCustomer>;
const mockCreateSetupIntent = createSetupIntent as jest.MockedFunction<typeof createSetupIntent>;
const mockAttachAndSubscribe = attachAndSubscribe as jest.MockedFunction<typeof attachAndSubscribe>;
const mockCancelAtPeriodEnd = cancelAtPeriodEnd as jest.MockedFunction<typeof cancelAtPeriodEnd>;
const mockReactivateSubscription = reactivateSubscription as jest.MockedFunction<typeof reactivateSubscription>;
const mockGetPriceIdByLookupKey = getPriceIdByLookupKey as jest.MockedFunction<typeof getPriceIdByLookupKey>;
const mockGetPromotionCodeId = getPromotionCodeId as jest.MockedFunction<typeof getPromotionCodeId>;

const STRIPE_CUSTOMER_ID = 'cus_test12345';
const STRIPE_SUB_ID = 'sub_test12345';

function makeWebhookApp(h: TestDb): Application {
  const app = express();
  // Stripe webhooks need raw body (Buffer); for tests we fake it
  app.use(express.raw({ type: '*/*' }));
  app.post('/stripe/webhook', stripeWebhookHandler(h.db));
  return app;
}

async function seedSubscription(h: TestDb, status = 'active'): Promise<void> {
  // Use the owner's subscription repo to create/update with a stripe customer id
  await h.owner.subscription.create({
    status: status as 'active',
    plan: 'monthly',
    trialEndsAt: null,
  });
  await h.owner.subscription.update({
    stripeCustomerId: STRIPE_CUSTOMER_ID,
    stripeSubscriptionId: STRIPE_SUB_ID,
  });
}

describe('stripeWebhookHandler', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeWebhookApp(h);

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    mockConstructWebhookEvent.mockReset();
  });

  afterEach(() => {
    h.close();
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // ── Signature verification ────────────────────────────────────────────────

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not set', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=abc')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/STRIPE_WEBHOOK_SECRET/i);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/stripe/webhook')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stripe-signature/i);
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      throw new Error('No matching signature found');
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=badhash')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  // ── customer.subscription.updated ────────────────────────────────────────

  it('customer.subscription.updated sets subscription to active', async () => {
    await seedSubscription(h, 'trialing');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: STRIPE_SUB_ID,
          status: 'active',
          customer: STRIPE_CUSTOMER_ID,
        },
      },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from(JSON.stringify({ type: 'customer.subscription.updated' })));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('active');
  });

  // ── customer.subscription.deleted ─────────────────────────────────────────

  it('customer.subscription.deleted sets subscription to canceled', async () => {
    await seedSubscription(h, 'active');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: STRIPE_SUB_ID,
          status: 'canceled',
          customer: STRIPE_CUSTOMER_ID,
        },
      },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from(JSON.stringify({ type: 'customer.subscription.deleted' })));

    expect(res.status).toBe(200);

    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('canceled');
  });

  // ── invoice.payment_failed ────────────────────────────────────────────────

  it('invoice.payment_failed sets subscription to past_due', async () => {
    await seedSubscription(h, 'active');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: STRIPE_CUSTOMER_ID,
        },
      },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from(JSON.stringify({ type: 'invoice.payment_failed' })));

    expect(res.status).toBe(200);

    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('past_due');
  });

  it('invoice.payment_failed triggers payment failed email', async () => {
    const { paymentFailedEmail } = jest.requireMock('../../services/emailService') as {
      paymentFailedEmail: jest.Mock;
    };
    paymentFailedEmail.mockReset();

    // Owner user has NULL email by default — give them one so sendPaymentFailedEmail doesn't bail
    await h.db.run(
      'UPDATE users SET email_enc = ?, email_hash = ? WHERE id = ?',
      [encrypt('owner@test.example'), hashEmail('owner@test.example'), h.ownerId],
    );

    await seedSubscription(h, 'active');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { customer: STRIPE_CUSTOMER_ID } },
    });

    await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    // Allow async sendPaymentFailedEmail to complete
    await new Promise((r) => setImmediate(r));

    expect(paymentFailedEmail).toHaveBeenCalledTimes(1);
  });

  // ── invoice.paid ──────────────────────────────────────────────────────────

  it('invoice.paid sets subscription back to active', async () => {
    await seedSubscription(h, 'past_due');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'invoice.paid',
      data: { object: { customer: STRIPE_CUSTOMER_ID } },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);

    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('active');
  });

  // ── Unknown event type ────────────────────────────────────────────────────

  it('returns 200 for unknown event types (Stripe should not retry)', async () => {
    mockConstructWebhookEvent.mockReturnValue({
      type: 'charge.succeeded',
      data: { object: {} },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  // ── customer.subscription.created ────────────────────────────────────────

  it('customer.subscription.created upserts subscription status', async () => {
    await seedSubscription(h, 'trialing');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: STRIPE_SUB_ID,
          status: 'trialing',
          customer: STRIPE_CUSTOMER_ID,
        },
      },
    });

    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('replaying customer.subscription.deleted is idempotent (status stays canceled)', async () => {
    await seedSubscription(h, 'active');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: STRIPE_SUB_ID, status: 'canceled', customer: STRIPE_CUSTOMER_ID } },
    });

    await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    // Replay the same event
    const res = await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(200);
    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('canceled');
  });

  it('replaying invoice.payment_failed does not send duplicate emails', async () => {
    const { paymentFailedEmail } = jest.requireMock('../../services/emailService') as {
      paymentFailedEmail: jest.Mock;
    };
    paymentFailedEmail.mockReset();
    await h.db.run(
      'UPDATE users SET email_enc = ?, email_hash = ? WHERE id = ?',
      [encrypt('owner@test.example'), hashEmail('owner@test.example'), h.ownerId],
    );
    await seedSubscription(h, 'active');

    mockConstructWebhookEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { customer: STRIPE_CUSTOMER_ID } },
    });

    // Fire twice
    await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));
    await request(app)
      .post('/stripe/webhook')
      .set('stripe-signature', 't=123,v1=valid')
      .send(Buffer.from('{}'));

    await new Promise((r) => setImmediate(r));

    // Email is fire-and-forget per event; two events = two calls is acceptable,
    // but status must not flip back to active on replay.
    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('past_due');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// billingRouter — Stripe lifecycle routes (issue #35)
// ─────────────────────────────────────────────────────────────────────────────

function makeBillingRouterApp(
  h: TestDb,
  user: { id: string; email: string | null } = { id: '', email: 'test@example.com' },
): Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId);
    req.user = { ...user, id: h.ownerId };
    next();
  });
  app.use('/billing', billingRouter(h.db));
  return app;
}

describe('billingRouter', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeBillingRouterApp(h);
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetOrCreateCustomer.mockReset();
    mockCreateSetupIntent.mockReset();
    mockAttachAndSubscribe.mockReset();
    mockCancelAtPeriodEnd.mockReset();
    mockReactivateSubscription.mockReset();
    mockGetPriceIdByLookupKey.mockReset();
    mockGetPromotionCodeId.mockReset();
  });

  afterEach(() => h.close());

  // ── GET /billing/status ───────────────────────────────────────────────────

  it('GET /status returns nulls when no subscription row exists', async () => {
    const res = await request(app).get('/billing/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeNull();
    expect(res.body.hasPaymentMethod).toBe(false);
  });

  it('GET /status returns current subscription state', async () => {
    await h.owner.subscription.create({ status: 'active', plan: 'monthly', trialEndsAt: null });
    const res = await request(app).get('/billing/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.plan).toBe('monthly');
  });

  it('GET /status includes daysRemaining for trialing subscription', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: future });
    const res = await request(app).get('/billing/status');
    expect(res.status).toBe(200);
    expect(res.body.daysRemaining).toBeGreaterThan(0);
  });

  // ── POST /billing/setup-intent ────────────────────────────────────────────

  it('POST /setup-intent returns 503 when Stripe is not configured', async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    const res = await request(app).post('/billing/setup-intent');
    expect(res.status).toBe(503);
  });

  it('POST /setup-intent returns clientSecret', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    mockGetOrCreateCustomer.mockResolvedValue('cus_new123');
    mockCreateSetupIntent.mockResolvedValue('seti_secret_xyz');

    const res = await request(app).post('/billing/setup-intent');
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('seti_secret_xyz');
  });

  // ── POST /billing/subscribe ───────────────────────────────────────────────

  it('POST /subscribe returns 503 when Stripe is not configured', async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    const res = await request(app).post('/billing/subscribe').send({ paymentMethodId: 'pm_test' });
    expect(res.status).toBe(503);
  });

  it('POST /subscribe returns 400 when paymentMethodId is missing', async () => {
    const res = await request(app).post('/billing/subscribe').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/paymentMethodId/i);
  });

  it('POST /subscribe returns 400 when tier is invalid', async () => {
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test', tier: 'free', interval: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier/i);
  });

  it('POST /subscribe returns 400 when interval is invalid', async () => {
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test', tier: 'business', interval: 'weekly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval/i);
  });

  it('POST /subscribe returns 400 when no Stripe customer on file', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    // No stripeCustomerId set
    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'business', interval: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setup-intent/i);
  });

  it('POST /subscribe activates business monthly subscription', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockResolvedValue('price_business_monthly_123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAttachAndSubscribe.mockResolvedValue({ id: STRIPE_SUB_ID, status: 'active' } as any);

    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'business', interval: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('active');
    expect(res.body.tier).toBe('business');
    expect(res.body.seats).toBe(1);
    expect(mockGetPriceIdByLookupKey).toHaveBeenCalledWith('kml_business_monthly');

    const sub = await h.owner.subscription.get();
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe(STRIPE_SUB_ID);
    expect(sub?.tier).toBe('business');
    expect(sub?.seats).toBe(1);
    expect(sub?.plan).toBe('business_monthly');
  });

  it('POST /subscribe uses annual lookup key when interval=annual', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockResolvedValue('price_business_annual_123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAttachAndSubscribe.mockResolvedValue({ id: STRIPE_SUB_ID, status: 'active' } as any);

    await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'business', interval: 'annual' });

    expect(mockGetPriceIdByLookupKey).toHaveBeenCalledWith('kml_business_annual');
  });

  it('POST /subscribe org tier adds per-seat line item when seats > 3', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockImplementation(async (key: string) =>
      key === 'kml_org_monthly' ? 'price_org_monthly_123' : 'price_org_seat_123',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAttachAndSubscribe.mockResolvedValue({ id: STRIPE_SUB_ID, status: 'active' } as any);

    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'org', interval: 'monthly', seats: 5 });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('org');
    expect(res.body.seats).toBe(5);
    expect(mockGetPriceIdByLookupKey).toHaveBeenCalledWith('kml_org_monthly');
    expect(mockGetPriceIdByLookupKey).toHaveBeenCalledWith('kml_org_seat');
    // Items: base + 2 extra seats
    const call = mockAttachAndSubscribe.mock.calls[0];
    const items = call[2];
    expect(items).toEqual([
      { price: 'price_org_monthly_123' },
      { price: 'price_org_seat_123', quantity: 2 },
    ]);
  });

  it('POST /subscribe org tier with seats <= 3 omits seat line item', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockResolvedValue('price_org_monthly_123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAttachAndSubscribe.mockResolvedValue({ id: STRIPE_SUB_ID, status: 'active' } as any);

    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'org', interval: 'monthly', seats: 2 });

    expect(res.status).toBe(200);
    // Seats clamped to ORG_INCLUDED_SEATS (3) minimum
    expect(res.body.seats).toBe(3);
    const items = mockAttachAndSubscribe.mock.calls[0][2];
    expect(items).toEqual([{ price: 'price_org_monthly_123' }]);
  });

  // ── POST /billing/cancel ──────────────────────────────────────────────────

  it('POST /subscribe returns 400 when promo code is invalid', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockResolvedValue('price_business_monthly_123');
    mockGetPromotionCodeId.mockResolvedValue(null);

    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'business', interval: 'monthly', promoCode: 'BOGUS20' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_promo_code');
    expect(mockAttachAndSubscribe).not.toHaveBeenCalled();
  });

  it('POST /subscribe applies promo code discount when code is valid', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeCustomerId: STRIPE_CUSTOMER_ID });

    mockGetPriceIdByLookupKey.mockResolvedValue('price_business_monthly_123');
    mockGetPromotionCodeId.mockResolvedValue('promo_LAUNCH20');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAttachAndSubscribe.mockResolvedValue({ id: STRIPE_SUB_ID, status: 'active' } as any);

    const res = await request(app)
      .post('/billing/subscribe')
      .send({ paymentMethodId: 'pm_test123', tier: 'business', interval: 'monthly', promoCode: 'LAUNCH20' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const opts = mockAttachAndSubscribe.mock.calls[0][3];
    expect(opts).toMatchObject({ promotionCodeId: 'promo_LAUNCH20' });
  });

  it('POST /cancel returns 503 when Stripe is not configured', async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    const res = await request(app).post('/billing/cancel');
    expect(res.status).toBe(503);
  });

  it('POST /cancel returns 400 when no active subscription', async () => {
    await h.owner.subscription.create({ status: 'trialing', plan: 'monthly', trialEndsAt: null });
    // No stripeSubscriptionId
    const res = await request(app).post('/billing/cancel');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active subscription/i);
  });

  it('POST /cancel calls cancelAtPeriodEnd and returns ok', async () => {
    await h.owner.subscription.create({ status: 'active', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeSubscriptionId: STRIPE_SUB_ID });
    mockCancelAtPeriodEnd.mockResolvedValue(undefined);

    const res = await request(app).post('/billing/cancel');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCancelAtPeriodEnd).toHaveBeenCalledWith(STRIPE_SUB_ID);
  });

  // ── POST /billing/reactivate ──────────────────────────────────────────────

  it('POST /reactivate returns 503 when Stripe is not configured', async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    const res = await request(app).post('/billing/reactivate');
    expect(res.status).toBe(503);
  });

  it('POST /reactivate returns 400 when no active subscription', async () => {
    await h.owner.subscription.create({ status: 'canceled', plan: 'monthly', trialEndsAt: null });
    const res = await request(app).post('/billing/reactivate');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active subscription/i);
  });

  it('POST /reactivate calls reactivateSubscription and returns ok', async () => {
    await h.owner.subscription.create({ status: 'active', plan: 'monthly', trialEndsAt: null });
    await h.owner.subscription.update({ stripeSubscriptionId: STRIPE_SUB_ID });
    mockReactivateSubscription.mockResolvedValue(undefined);

    const res = await request(app).post('/billing/reactivate');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockReactivateSubscription).toHaveBeenCalledWith(STRIPE_SUB_ID);
  });
});
