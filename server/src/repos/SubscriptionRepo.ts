/**
 * Subscription state for a user. Stripe columns remain null until Phase 4b.
 */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';

export interface Subscription {
  userId: string;
  status: SubscriptionStatus;
  plan: string;
  trialEndsAt: string | null;          // ISO datetime (UTC)
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRepo {
  /** Get the subscription for this user, or undefined if none exists. */
  get(): Promise<Subscription | undefined>;

  /**
   * Insert a new subscription row. Idempotent: silently no-ops if a row
   * already exists (matches ON CONFLICT DO NOTHING).
   */
  create(data: Pick<Subscription, 'status' | 'plan' | 'trialEndsAt'>): Promise<void>;

  /** Update mutable fields. Automatically bumps updated_at. */
  update(data: Partial<Pick<Subscription, 'status' | 'plan' | 'trialEndsAt' | 'currentPeriodEnd' | 'stripeCustomerId' | 'stripeSubscriptionId'>>): Promise<void>;
}
