/**
 * Subscription state for an organization.
 *
 * `tier` is the product capability tier ('free' | 'business' | 'org') —
 * independent of `status` (trialing/active/canceled/…). Trials are tier='free'
 * with status='trialing'; paid subs flip tier on subscribe.
 *
 * `grantedByAdminId` / `grantedAt` are set when an admin comps the tier
 * locally (no Stripe subscription); allows revocation and audit.
 */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
export type SubscriptionTier = 'free' | 'business' | 'org';

export interface Subscription {
  orgId: string;
  status: SubscriptionStatus;
  plan: string;
  tier: SubscriptionTier;
  seats: number;
  trialEndsAt: string | null;          // ISO datetime (UTC)
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  grantedByAdminId: string | null;
  grantedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRepo {
  /** Get the subscription for this org, or undefined if none exists. */
  get(): Promise<Subscription | undefined>;

  /**
   * Insert a new subscription row. Idempotent: silently no-ops if a row
   * already exists (matches ON CONFLICT DO NOTHING). `tier` defaults to
   * 'free' and `seats` to 1 when not provided.
   */
  create(data: Pick<Subscription, 'status' | 'plan' | 'trialEndsAt'> & Partial<Pick<Subscription, 'tier' | 'seats'>>): Promise<void>;

  /** Update mutable fields. Automatically bumps updated_at. */
  update(data: Partial<Pick<Subscription,
    | 'status'
    | 'plan'
    | 'tier'
    | 'seats'
    | 'trialEndsAt'
    | 'currentPeriodEnd'
    | 'stripeCustomerId'
    | 'stripeSubscriptionId'
    | 'grantedByAdminId'
    | 'grantedAt'
  >>): Promise<void>;

  /**
   * Update subscription fields keyed by stripe_customer_id.
   * Used by webhook handlers where the org_id is not known upfront.
   */
  updateByStripeCustomerId(
    customerId: string,
    data: Partial<Pick<Subscription, 'status' | 'currentPeriodEnd' | 'tier' | 'seats' | 'stripeSubscriptionId'>>,
  ): Promise<void>;
}
