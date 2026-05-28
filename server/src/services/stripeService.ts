/**
 * Thin wrapper around the Stripe SDK.
 * All Stripe interactions (customer, subscription, payment method) live here.
 * Lazily initialised so the server starts fine without STRIPE_SECRET_KEY.
 */
import Stripe from 'stripe';

type StripeClient = InstanceType<typeof Stripe>;

let _stripe: StripeClient | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe(): StripeClient {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/**
 * Return an existing Stripe customer ID, or create a new customer and return
 * the fresh ID.
 */
export async function getOrCreateCustomer(
  existingCustomerId: string | null,
  userId: string,
  email: string | null,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { userId },
  });
  return customer.id;
}

/**
 * Create a SetupIntent for collecting a payment method off-session.
 * Returns the client_secret that the frontend passes to <PaymentElement>.
 */
export async function createSetupIntent(customerId: string): Promise<string> {
  const stripe = getStripe();
  const intent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });
  if (!intent.client_secret) throw new Error('SetupIntent returned no client_secret');
  return intent.client_secret;
}

/**
 * Resolve a Stripe price lookup key to its price ID.
 * Throws if no active price is found for that key.
 */
export async function getPriceIdByLookupKey(lookupKey: string): Promise<string> {
  const stripe = getStripe();
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`No active Stripe price found for lookup key: ${lookupKey}`);
  return price.id;
}

/**
 * Resolve a Stripe promotion code (the human-redeemable code) to its
 * promotion_code id (`promo_...`). Returns null when no active code matches.
 */
export async function getPromotionCodeId(code: string): Promise<string | null> {
  const stripe = getStripe();
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  return list.data[0]?.id ?? null;
}

/**
 * Attach a payment method to a customer, set it as their invoice default,
 * then create a subscription (skipping if one already exists and is active).
 *
 * `items` is the array of line items (`price`, optional `quantity`) so callers
 * can compose a base-plan + per-seat subscription for the Org tier.
 *
 * NOTE: the `items` API replaced the legacy `priceId: string` signature as
 * part of the tier-pricing rewrite (PR #70). The only in-tree caller is
 * `routes/billing.ts`. If you have out-of-tree tooling that calls this
 * function directly, update it to pass `[{ price: '...' }]` instead.
 */
export async function attachAndSubscribe(
  customerId: string,
  paymentMethodId: string,
  items: Array<{ price: string; quantity?: number }>,
  opts?: { promotionCodeId?: string | null },
) {
  const stripe = getStripe();

  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  // Avoid creating a duplicate subscription.
  const existing = await stripe.subscriptions.list({ customer: customerId, limit: 1 });
  if (
    existing.data.length > 0 &&
    existing.data[0].status !== 'canceled'
  ) {
    return existing.data[0];
  }

  const params: Parameters<typeof stripe.subscriptions.create>[0] = {
    customer: customerId,
    items,
  };
  if (opts?.promotionCodeId) {
    params.discounts = [{ promotion_code: opts.promotionCodeId }];
  }
  return stripe.subscriptions.create(params);
}

/** Cancel the subscription at the end of the current billing period. */
export async function cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

/** Cancel the subscription immediately (used when deleting an account). */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(subscriptionId);
}

/** Undo cancel-at-period-end (reactivate a subscription). */
export async function reactivateSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
}

/** Return the last-4 digits of the customer's default card, or null. */
export async function getDefaultPaymentMethodLast4(customerId: string): Promise<string | null> {
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId) as { deleted?: boolean; invoice_settings?: { default_payment_method?: unknown } };
    if (customer.deleted) return null;
    const pmId = customer.invoice_settings?.default_payment_method;
    if (!pmId || typeof pmId !== 'string') return null;
    const pm = await stripe.paymentMethods.retrieve(pmId);
    return pm.card?.last4 ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify and parse a Stripe webhook payload.
 * Throws if the signature is invalid.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
  secret: string,
): { type: string; data: { object: unknown } } {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, secret) as { type: string; data: { object: unknown } };
}
