import { Router, Request, Response } from 'express';
import { getAppMode } from '../auth/context';

export function billingRouter(): Router {
  const router = Router();

  /**
   * GET /api/billing/status
   * Returns the current user's subscription state. Safe for polling by the
   * frontend (no Stripe calls until Phase 4b).
   */
  router.get('/status', (req: Request, res: Response): void => {
    void (async () => {
      try {
        const sub = await req.ctx!.repos.subscription.get();

        if (!sub) {
          // SaaS user with no row shouldn't happen after first-login provision,
          // but handle gracefully.
          res.json({
            status: null,
            plan: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
            daysRemaining: null,
            hasPaymentMethod: false,
          });
          return;
        }

        const daysRemaining = sub.trialEndsAt
          ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : null;

        res.json({
          status: sub.status,
          plan: sub.plan,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          daysRemaining,
          hasPaymentMethod: false, // Populated by Stripe in Phase 4b
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  return router;
}

/**
 * devBillingRouter — gated behind DEV_TOOLS=1 env variable.
 * Allows setting subscription state without Stripe, for E2E testing.
 *
 * POST /api/dev/subscription
 * Body: { status, trialEndsAt? }
 */
export function devBillingRouter(): Router {
  const router = Router();

  if (process.env.DEV_TOOLS !== '1') {
    // Return an empty router when not in dev mode — no routes exposed.
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
