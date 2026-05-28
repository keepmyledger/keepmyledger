import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getAppMode } from '../auth/context';
import { isStripeConfigured } from '../services/stripeService';

/**
 * Middleware that gates write/import/AI routes on an active subscription.
 *
 * - Self-host: always allows (short-circuits immediately).
 * - SaaS, Stripe not configured (dark-launch / pre-billing): always allows.
 * - SaaS, no subscription row: 402 (trial not provisioned; shouldn't happen
 *   after first-login provisioning, but defensive).
 * - SaaS, status trialing/active: allows.
 * - SaaS, status past_due/canceled/incomplete: 402.
 *
 * Depends on `requireUser` having already run so that `req.ctx` is populated.
 */
export function requireActiveSubscription(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        // Self-host is always allowed.
        if (getAppMode() !== 'saas') {
          next();
          return;
        }

        // Dark-launch: until Stripe is configured, billing is invisible to
        // users and trials don't expire. Subscribe button shows "Billing
        // launches soon" — see web/src/pages/Billing.tsx + TrialBanner.tsx.
        if (!isStripeConfigured()) {
          next();
          return;
        }

        const ctx = req.ctx;
        if (!ctx) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const sub = await ctx.repos.subscription.get();

        if (!sub) {
          // No row should only happen if provisionDefaults wasn't called.
          res.status(402).json({
            error: 'subscription_required',
            status: null,
            trialEndsAt: null,
          });
          return;
        }

        const allowed: ReadonlyArray<string> = ['trialing', 'active'];
        if (!allowed.includes(sub.status)) {
          res.status(402).json({
            error: 'subscription_required',
            status: sub.status,
            trialEndsAt: sub.trialEndsAt,
          });
          return;
        }

        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
