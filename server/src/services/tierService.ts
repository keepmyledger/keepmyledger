/**
 * Tier-aware capability predicates.
 *
 * The `tier` column on `subscriptions` is the product capability dimension
 * (free / business / org); `status` is orthogonal (trialing / active / …).
 * Self-host mode (`APP_MODE != 'saas'`) bypasses all gates: every capability
 * returns `true` regardless of tier.
 *
 * Lifetime AI cap on free tier is enforced separately in
 * `routes/transactions.ts` using `getAiLimit(sub)`.
 */
import type { Subscription, SubscriptionTier } from '../repos/SubscriptionRepo';
import { getAppMode, getAiDailyLimit } from '../auth/context';

/** Free-tier lifetime cap on AI assist calls (total, not per-day). */
export const FREE_TIER_AI_LIFETIME_LIMIT = 5;

/** Org tier's number of seats included in the base price. */
export const ORG_INCLUDED_SEATS = 3;

export interface TierCapabilities {
  /** Unlimited AI assist (subject only to the global daily cap). */
  aiUnlimited: boolean;
  /** Allowed to store receipts on S3 (#20). */
  s3Receipts: boolean;
  /** Allowed to set a custom business logo (#13). */
  customLogo: boolean;
  /** Allowed to create / belong to multi-business orgs with invites. */
  multiBusiness: boolean;
  /** Maximum number of seats the tier permits (Infinity = no cap). */
  maxSeats: number;
}

const CAPS: Record<SubscriptionTier, TierCapabilities> = {
  free:     { aiUnlimited: false, s3Receipts: false, customLogo: false, multiBusiness: false, maxSeats: 1 },
  business: { aiUnlimited: true,  s3Receipts: true,  customLogo: true,  multiBusiness: false, maxSeats: 1 },
  org:      { aiUnlimited: true,  s3Receipts: true,  customLogo: true,  multiBusiness: true,  maxSeats: Infinity },
};

/** Return the resolved capability set for a subscription (or null/undefined → free). */
export function getCapabilities(sub: Subscription | null | undefined): TierCapabilities {
  if (getAppMode() !== 'saas') {
    return { aiUnlimited: true, s3Receipts: true, customLogo: true, multiBusiness: true, maxSeats: Infinity };
  }
  return CAPS[sub?.tier ?? 'free'];
}

/**
 * AI assist quota for a subscription.
 *
 * Returns an object describing the cap:
 *   - `kind: 'lifetime'`  — total calls ever (free tier, limit=5).
 *   - `kind: 'daily'`     — per-day cap (paid tiers, falls back to `AI_DAILY_LIMIT`).
 *   - `kind: 'unlimited'` — no cap (self-host, or paid tier with daily=0).
 */
export type AiQuota =
  | { kind: 'lifetime'; limit: number }
  | { kind: 'daily';    limit: number }
  | { kind: 'unlimited' };

export function getAiQuota(sub: Subscription | null | undefined): AiQuota {
  // Self-host: AI_DAILY_LIMIT env still applies (defaults to 0 = unlimited).
  // Tier doesn't gate anything in self-host.
  if (getAppMode() !== 'saas') {
    const daily = getAiDailyLimit();
    return daily > 0 ? { kind: 'daily', limit: daily } : { kind: 'unlimited' };
  }

  const tier = sub?.tier ?? 'free';
  if (tier === 'free') {
    return { kind: 'lifetime', limit: FREE_TIER_AI_LIFETIME_LIMIT };
  }

  const daily = getAiDailyLimit();
  if (daily <= 0) return { kind: 'unlimited' };
  return { kind: 'daily', limit: daily };
}
