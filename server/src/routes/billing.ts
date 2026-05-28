import { Router, Request, Response, RequestHandler } from 'express';
import type { DbAdapter } from '../db/adapter';
import { getAppMode, createGlobalSubscriptionRepo } from '../auth/context';
import { paymentFailedEmail } from '../services/emailService';
import { decryptNullable } from '../auth/crypto';
import type { SubscriptionTier } from '../repos/SubscriptionRepo';
import { ORG_INCLUDED_SEATS, FREE_TIER_AI_LIFETIME_LIMIT } from '../services/tierService';
import {
  isStripeConfigured,
  getOrCreateCustomer,
  createSetupIntent,
  attachAndSubscribe,
  cancelAtPeriodEnd,
  reactivateSubscription,
  getDefaultPaymentMethodLast4,
  constructWebhookEvent,
  getPriceIdByLookupKey,
  getPromotionCodeId,
} from '../services/stripeService';

export function billingRouter(db: DbAdapter): Router {
  const router = Router();

  /**
   * GET /api/billing/status
   * Returns the current user's subscription state.
   * When Stripe is configured and the user has a customer ID, fetches the
   * default payment method last-4 from Stripe.
   */
  router.get('/status', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const sub = await req.ctx!.repos.subscription.get();

        if (!sub) {
          res.json({
            status: null,
            plan: null,
            tier: null,
            seats: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
            daysRemaining: null,
            hasPaymentMethod: false,
            last4: null,
            aiLifetimeCount: null,
            aiLifetimeLimit: null,
          });
          return;
        }

        const daysRemaining = sub.trialEndsAt
          ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : null;

        let last4: string | null = null;
        if (isStripeConfigured() && sub.stripeCustomerId) {
          last4 = await getDefaultPaymentMethodLast4(sub.stripeCustomerId);
        }

        // For free-tier users, include their lifetime AI usage so the UI can
        // show a usage counter without a separate API call.
        const effectiveTier = sub.tier ?? 'free';
        let aiLifetimeCount: number | null = null;
        if (effectiveTier === 'free') {
          aiLifetimeCount = await req.ctx!.repos.aiUsage.getLifetimeCount();
        }

        res.json({
          status: sub.status,
          plan: sub.plan,
          tier: sub.tier,
          seats: sub.seats,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          daysRemaining,
          hasPaymentMethod: last4 !== null,
          last4,
          aiLifetimeCount,
          aiLifetimeLimit: effectiveTier === 'free' ? FREE_TIER_AI_LIFETIME_LIMIT : null,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  /**
   * POST /api/billing/setup-intent
   * Creates a Stripe SetupIntent and returns its client_secret so the frontend
   * can render <PaymentElement>.
   */
  router.post('/setup-intent', (req: Request, res: Response): void => {
    void (async () => {
      try {
        if (!isStripeConfigured()) {
          res.status(503).json({ error: 'Billing is not configured' });
          return;
        }

        const sub = await req.ctx!.repos.subscription.get();
        const user = req.user as { id: string; email: string | null } | undefined;
        if (!user) { res.status(401).json({ error: 'Unauthenticated' }); return; }

        const customerId = await getOrCreateCustomer(
          sub?.stripeCustomerId ?? null,
          req.ctx!.orgId,
          user.email,
        );

        if (sub && !sub.stripeCustomerId) {
          await req.ctx!.repos.subscription.update({ stripeCustomerId: customerId });
        }

        const clientSecret = await createSetupIntent(customerId);
        res.json({ clientSecret });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  /**
   * POST /api/billing/subscribe
   * Body: {
   *   paymentMethodId: string,
   *   tier: 'business' | 'org',
   *   interval: 'monthly' | 'annual',
   *   seats?: number,           // Org only; clamped to >= ORG_INCLUDED_SEATS (3)
   *   promoCode?: string,       // optional Stripe promotion code (human form)
   * }
   *
   * Resolves prices via lookup keys: `kml_${tier}_${interval}`. For the Org
   * tier with seats > included, adds a per-seat line item `kml_org_seat`
   * with quantity = seats - included. Updates our subscriptions row with
   * tier and seat count so callers (UI, capability checks) read it back.
   */
  router.post('/subscribe', (req: Request, res: Response): void => {
    void (async () => {
      try {
        if (!isStripeConfigured()) {
          res.status(503).json({ error: 'Billing is not configured' });
          return;
        }

        const { paymentMethodId, tier, interval, seats, promoCode } = req.body as {
          paymentMethodId?: string;
          tier?: string;
          interval?: string;
          seats?: number;
          promoCode?: string;
        };
        if (!paymentMethodId || typeof paymentMethodId !== 'string') {
          res.status(400).json({ error: 'paymentMethodId is required' });
          return;
        }
        if (tier !== 'business' && tier !== 'org') {
          res.status(400).json({ error: 'tier must be business or org' });
          return;
        }
        if (interval !== 'monthly' && interval !== 'annual') {
          res.status(400).json({ error: 'interval must be monthly or annual' });
          return;
        }
        const tierTyped: Exclude<SubscriptionTier, 'free'> = tier;

        let seatCount = 1;
        if (tierTyped === 'org') {
          const requested = typeof seats === 'number' && Number.isFinite(seats) ? Math.floor(seats) : ORG_INCLUDED_SEATS;
          seatCount = Math.max(ORG_INCLUDED_SEATS, requested);
        }

        const sub = await req.ctx!.repos.subscription.get();
        if (!sub?.stripeCustomerId) {
          res.status(400).json({ error: 'No Stripe customer on file. Call setup-intent first.' });
          return;
        }

        const basePriceId = await getPriceIdByLookupKey(`kml_${tierTyped}_${interval}`);
        const items: Array<{ price: string; quantity?: number }> = [{ price: basePriceId }];
        if (tierTyped === 'org' && seatCount > ORG_INCLUDED_SEATS) {
          const seatPriceId = await getPriceIdByLookupKey('kml_org_seat');
          items.push({ price: seatPriceId, quantity: seatCount - ORG_INCLUDED_SEATS });
        }

        let promotionCodeId: string | null = null;
        if (typeof promoCode === 'string' && promoCode.trim()) {
          promotionCodeId = await getPromotionCodeId(promoCode.trim());
          if (!promotionCodeId) {
            res.status(400).json({ error: 'invalid_promo_code' });
            return;
          }
        }

        const stripeSub = await attachAndSubscribe(
          sub.stripeCustomerId,
          paymentMethodId,
          items,
          { promotionCodeId },
        );

        // The webhook customer.subscription.updated will reconcile state; we
        // optimistically write the tier/seats/status now for instant UI sync.
        await req.ctx!.repos.subscription.update({
          status: stripeSub.status as 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete',
          stripeSubscriptionId: stripeSub.id,
          plan: `${tierTyped}_${interval}`,
          tier: tierTyped,
          seats: seatCount,
        });

        res.json({ ok: true, status: stripeSub.status, tier: tierTyped, seats: seatCount });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  /**
   * POST /api/billing/cancel
   * Sets cancel_at_period_end on the Stripe subscription.
   */
  router.post('/cancel', (req: Request, res: Response): void => {
    void (async () => {
      try {
        if (!isStripeConfigured()) {
          res.status(503).json({ error: 'Billing is not configured' });
          return;
        }

        const sub = await req.ctx!.repos.subscription.get();
        if (!sub?.stripeSubscriptionId) {
          res.status(400).json({ error: 'No active subscription found' });
          return;
        }

        await cancelAtPeriodEnd(sub.stripeSubscriptionId);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  /**
   * POST /api/billing/reactivate
   * Undoes cancel_at_period_end (keeps subscription active through period end).
   */
  router.post('/reactivate', (req: Request, res: Response): void => {
    void (async () => {
      try {
        if (!isStripeConfigured()) {
          res.status(503).json({ error: 'Billing is not configured' });
          return;
        }

        const sub = await req.ctx!.repos.subscription.get();
        if (!sub?.stripeSubscriptionId) {
          res.status(400).json({ error: 'No active subscription found' });
          return;
        }

        await reactivateSubscription(sub.stripeSubscriptionId);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // Suppress unused-variable warning; db used by stripeWebhookHandler below.
  void db;

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// stripeWebhookHandler: mounted with express.raw() BEFORE express.json().
// Cross-user: resolves the user by stripe_customer_id via a direct DB query.
// ─────────────────────────────────────────────────────────────────────────────

export function stripeWebhookHandler(db: DbAdapter): RequestHandler {
  return (req: Request, res: Response): void => {
    void (async () => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' });
        return;
      }

      const sig = req.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      let event: { type: string; data: { object: unknown } };
      try {
        event = constructWebhookEvent(req.body as Buffer, sig, secret);
      } catch (err) {
        console.error('[stripe-webhook] signature verification failed:', (err as Error).message);
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }

      try {
        await handleStripeEvent(db, event);
        res.json({ received: true });
      } catch (err) {
        console.error('[stripe-webhook] handler error:', (err as Error).message);
        // Return 200 so Stripe does not retry; log and investigate manually.
        res.json({ received: true });
      }
    })();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event dispatcher
// ─────────────────────────────────────────────────────────────────────────────

type StripeEvent = { type: string; data: { object: unknown } };

type StripeSubObject = {
  id: string;
  status: string;
  customer: string | { id?: string } | null;
  items?: {
    data: Array<{
      quantity?: number;
      price?: { lookup_key?: string | null } | null;
    }>;
  };
};

type StripeInvoiceObject = {
  customer: string | { id?: string } | null;
};

function extractCustomerId(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (val && typeof (val as Record<string, unknown>).id === 'string') {
    return (val as { id: string }).id;
  }
  return null;
}

async function handleStripeEvent(db: DbAdapter, event: StripeEvent): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as StripeSubObject;
      await upsertSubscriptionFromStripe(db, sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as StripeSubObject;
      const cid = extractCustomerId(sub.customer);
      if (cid) {
        await createGlobalSubscriptionRepo(db).updateByStripeCustomerId(cid, { status: 'canceled' });
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as StripeInvoiceObject;
      const cid = extractCustomerId(invoice.customer);
      if (cid) {
        await createGlobalSubscriptionRepo(db).updateByStripeCustomerId(cid, { status: 'active' });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as StripeInvoiceObject;
      const cid = extractCustomerId(invoice.customer);
      if (cid) {
        await createGlobalSubscriptionRepo(db).updateByStripeCustomerId(cid, { status: 'past_due' });
        await sendPaymentFailedEmail(db, cid);
      }
      break;
    }

    default:
      break;
  }
}

async function upsertSubscriptionFromStripe(db: DbAdapter, sub: StripeSubObject): Promise<void> {
  const cid = extractCustomerId(sub.customer);
  if (!cid) return;

  // Try to derive tier + seat count from the subscription items.
  // Expects line items with lookup_keys like `kml_business_monthly`,
  // `kml_org_annual`, plus optional `kml_org_seat` per-seat add-on.
  //
  // The loop is order-tolerant: if the `kml_org_seat` item appears before
  // the base plan item, it defaults `seats` to ORG_INCLUDED_SEATS before
  // adding the extra-seat quantity. The base plan check then sees seats
  // already set and skips the default assignment, preserving the count.
  let tier: SubscriptionTier | null = null;
  let seats: number | null = null;
  const items = sub.items?.data ?? [];
  for (const item of items) {
    const lk = item.price?.lookup_key ?? null;
    if (!lk) continue;
    if (lk === 'kml_org_seat') {
      seats = (seats ?? ORG_INCLUDED_SEATS) + (item.quantity ?? 0);
      continue;
    }
    const m = /^kml_(business|org)_(monthly|annual)$/.exec(lk);
    if (m) {
      tier = m[1] as SubscriptionTier;
      // Base plan accounts for the included seats by default; per-seat
      // line items above add to that count.
      if (tier === 'org' && seats === null) seats = ORG_INCLUDED_SEATS;
      if (tier === 'business' && seats === null) seats = 1;
    }
  }

  // Defensive: a Stripe subscription with tier='business' and seats > 1 would
  // indicate a malformed price configuration (e.g., a kml_org_seat line item
  // paired with a kml_business_monthly base plan). That shouldn't happen via
  // normal checkout, but log a warning so it's visible if it ever does.
  if (tier === 'business' && seats !== null && seats > 1) {
    console.warn(
      `[billing] upsertSubscriptionFromStripe: unexpected seats=${seats} on business tier ` +
      `for subscription ${sub.id} — check Stripe price configuration`,
    );
  }

  await createGlobalSubscriptionRepo(db).updateByStripeCustomerId(cid, {
    status: sub.status as import('../repos/SubscriptionRepo').SubscriptionStatus,
    stripeSubscriptionId: sub.id,
    ...(tier ? { tier } : {}),
    ...(seats !== null ? { seats } : {}),
  });
}

async function sendPaymentFailedEmail(db: DbAdapter, customerId: string): Promise<void> {
  // Find the org that owns this subscription.
  const row = await db.get<{ org_id: string }>(
    `SELECT org_id FROM subscriptions WHERE stripe_customer_id = ?`,
    [customerId],
  );
  if (!row) return;

  // Personal orgs use org_id == user_id; find the org owner.
  const userRow = await db.get<{ email_enc: string | null; name_enc: string | null; username: string | null }>(
    `SELECT u.email_enc, u.name_enc, u.username
     FROM users u
     JOIN org_memberships m ON m.user_id = u.id
     WHERE m.org_id = ? AND m.role = 'owner'
     LIMIT 1`,
    [row.org_id],
  );
  const email = decryptNullable(userRow?.email_enc ?? null);
  if (!email) return;

  const name = decryptNullable(userRow?.name_enc ?? null);
  const displayName = name ?? userRow?.username ?? email;
  paymentFailedEmail(displayName, email);
}

/**
 * devBillingRouter: gated behind DEV_TOOLS=1 env variable.
 * Allows setting subscription state without Stripe, for E2E testing.
 *
 * POST /api/dev/subscription
 * Body: { status, trialEndsAt? }
 */
export function devBillingRouter(): Router {
  const router = Router();

  if (process.env.DEV_TOOLS !== '1') {
    // Return an empty router when not in dev mode; no routes exposed.
    return router;
  }

  router.post('/subscription', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const { status, trialEndsAt, plan } = req.body as {
          status?: string;
          trialEndsAt?: string;
          plan?: string;
        };

        const sub = await req.ctx!.repos.subscription.get();

        const validStatuses = ['trialing', 'active', 'past_due', 'canceled', 'incomplete'] as const;
        type ValidStatus = (typeof validStatuses)[number];
        const isValid = (s: unknown): s is ValidStatus => validStatuses.includes(s as ValidStatus);

        if (status !== undefined && !isValid(status)) {
          res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
          return;
        }

        if (!sub) {
          // Create row if missing
          await req.ctx!.repos.subscription.create({
            status: isValid(status) ? status : 'trialing',
            plan: plan ?? 'beta',
            trialEndsAt: trialEndsAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          });
        } else {
          await req.ctx!.repos.subscription.update({
            ...(isValid(status) ? { status } : {}),
            ...(trialEndsAt !== undefined ? { trialEndsAt } : {}),
            ...(plan !== undefined ? { plan } : {}),
          });
        }

        const updated = await req.ctx!.repos.subscription.get();
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  return router;
}

/** Returns the APP_MODE so the config endpoint can expose it. */
export { getAppMode };
