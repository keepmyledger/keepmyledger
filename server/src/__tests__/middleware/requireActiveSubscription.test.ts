import type { Request, Response, NextFunction } from 'express';
import { requireActiveSubscription } from '../../middleware/requireActiveSubscription';
import type { Repos } from '../../repos/impl';
import type { Subscription } from '../../repos/SubscriptionRepo';

interface Outcome {
  nextCalled: boolean;
  nextErr?: unknown;
  status?: number;
  body?: unknown;
}

function makeCtx(sub: Subscription | undefined): { repos: Pick<Repos, 'subscription'> } {
  return {
    repos: {
      subscription: { get: async () => sub } as Repos['subscription'],
    } as Repos,
  };
}

async function invoke(ctx: ReturnType<typeof makeCtx> | undefined): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    const outcome: Outcome = { nextCalled: false };
    const res = {
      status(code: number) { outcome.status = code; return this; },
      json(body: unknown) { outcome.body = body; resolve(outcome); return this; },
    } as unknown as Response;
    const next: NextFunction = (err?: unknown) => {
      outcome.nextCalled = true;
      outcome.nextErr = err;
      resolve(outcome);
    };
    const req = { ctx } as unknown as Request;
    requireActiveSubscription()(req, res, next);
  });
}

function makeSub(status: Subscription['status'], trialEndsAt: string | null = null): Subscription {
  return {
    orgId: 'test-org',
    status,
    plan: 'beta',
    tier: 'free',
    seats: 1,
    trialEndsAt,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    grantedByAdminId: null,
    grantedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('requireActiveSubscription middleware', () => {
  const ORIGINAL = process.env.APP_MODE;
  const ORIGINAL_STRIPE = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = ORIGINAL;
    if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE;
  });

  describe('self-host mode', () => {
    beforeEach(() => { delete process.env.APP_MODE; });

    it('always calls next regardless of subscription state', async () => {
      // No subscription row at all
      const out = await invoke(makeCtx(undefined));
      expect(out.nextCalled).toBe(true);
      expect(out.status).toBeUndefined();
    });

    it('calls next even for a canceled subscription', async () => {
      const out = await invoke(makeCtx(makeSub('canceled')));
      expect(out.nextCalled).toBe(true);
    });
  });

  describe('saas mode (stripe configured)', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'saas';
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    });

    it('returns 401 when ctx is missing (requireUser not run)', async () => {
      const out = await invoke(undefined);
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(401);
    });

    it('returns 402 subscription_required when no subscription row exists', async () => {
      const out = await invoke(makeCtx(undefined));
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(402);
      expect((out.body as { error: string }).error).toBe('subscription_required');
      expect((out.body as { status: null }).status).toBeNull();
    });

    it('allows trialing subscriptions', async () => {
      const out = await invoke(makeCtx(makeSub('trialing', new Date(Date.now() + 7 * 86400_000).toISOString())));
      expect(out.nextCalled).toBe(true);
      expect(out.status).toBeUndefined();
    });

    it('allows active subscriptions', async () => {
      const out = await invoke(makeCtx(makeSub('active')));
      expect(out.nextCalled).toBe(true);
    });

    it('returns 402 for past_due subscriptions', async () => {
      const out = await invoke(makeCtx(makeSub('past_due')));
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(402);
      expect((out.body as { error: string }).error).toBe('subscription_required');
      expect((out.body as { status: string }).status).toBe('past_due');
    });

    it('returns 402 for canceled subscriptions', async () => {
      const out = await invoke(makeCtx(makeSub('canceled')));
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(402);
      expect((out.body as { status: string }).status).toBe('canceled');
    });

    it('returns 402 for incomplete subscriptions', async () => {
      const out = await invoke(makeCtx(makeSub('incomplete')));
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(402);
    });

    it('includes trialEndsAt in the 402 body', async () => {
      const trialEndsAt = new Date(Date.now() - 86400_000).toISOString(); // expired yesterday
      const out = await invoke(makeCtx(makeSub('canceled', trialEndsAt)));
      expect((out.body as { trialEndsAt: string }).trialEndsAt).toBe(trialEndsAt);
    });
  });

  describe('saas mode (dark-launch: stripe NOT configured)', () => {
    beforeEach(() => {
      process.env.APP_MODE = 'saas';
      delete process.env.STRIPE_SECRET_KEY;
    });

    it('allows requests even when subscription is canceled', async () => {
      const out = await invoke(makeCtx(makeSub('canceled')));
      expect(out.nextCalled).toBe(true);
      expect(out.status).toBeUndefined();
    });

    it('allows requests when no subscription row exists', async () => {
      const out = await invoke(makeCtx(undefined));
      expect(out.nextCalled).toBe(true);
      expect(out.status).toBeUndefined();
    });
  });
});
