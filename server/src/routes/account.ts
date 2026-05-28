import { Router } from 'express';
import type { DbAdapter } from '../db/adapter';
import { cancelSubscriptionNow, isStripeConfigured } from '../services/stripeService';
import { getUserRepo } from '../auth/context';
import type { ReceiptStoragePreference } from '@keepmyledger/shared';

export function accountRouter(db: DbAdapter): Router {
  const router = Router();

  // ── GET /api/account/export ─────────────────────────────────────────────────
  // Returns a JSON dump of the user's own data as a downloadable file.
  router.get('/export', async (req, res) => {
    try {
      const userId = req.ctx!.userId;

      const [accounts, categories, transactions, rules, statements] = await Promise.all([
        db.all<Record<string, unknown>>(`SELECT * FROM accounts WHERE user_id = ?`, [userId]),
        db.all<Record<string, unknown>>(`SELECT * FROM categories WHERE user_id = ?`, [userId]),
        db.all<Record<string, unknown>>(`SELECT * FROM transactions WHERE user_id = ?`, [userId]),
        db.all<Record<string, unknown>>(`SELECT * FROM rules WHERE user_id = ?`, [userId]),
        db.all<Record<string, unknown>>(`SELECT * FROM statements WHERE user_id = ?`, [userId]),
      ]);

      res.setHeader('Content-Disposition', 'attachment; filename="keepmyledger-export.json"');
      res.setHeader('Content-Type', 'application/json');
      res.json({
        exportedAt: new Date().toISOString(),
        accounts,
        categories,
        transactions,
        rules,
        statements,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── DELETE /api/account ─────────────────────────────────────────────────────
  // Hard-deletes the account. ON DELETE CASCADE in the schema handles all child
  // rows. The Stripe subscription (if any) is cancelled immediately first.
  router.delete('/', async (req, res) => {
    try {
      const userId = req.ctx!.userId;

      // Cancel Stripe subscription immediately if one exists.
      // subscriptions.org_id is the PK; personal org id = userId by convention.
      if (isStripeConfigured()) {
        const sub = await db.get<{ stripe_subscription_id: string | null }>(
          `SELECT stripe_subscription_id FROM subscriptions WHERE org_id = ?`,
          [userId],
        );
        if (sub?.stripe_subscription_id) {
          try {
            await cancelSubscriptionNow(sub.stripe_subscription_id);
          } catch (err) {
            // Log but do not block the deletion; the subscription may already be
            // cancelled or the user may never have had billing set up.
            console.error('[account-delete] stripe cancel failed:', (err as Error).message);
          }
        }
      }

      // Deleting the user row cascades to all child tables (see migrations).
      await getUserRepo(db).delete(userId);

      // Destroy the session and log the user out.
      req.logout(() => {
        req.session.destroy(() => {
          res.json({ ok: true });
        });
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── PUT /api/account/receipt-storage ───────────────────────────────────────
  // Set the user's preferred receipt-storage backend. Body: { preference } where
  // preference ∈ 'kml' | 'drive' | null (null = follow server default).
  router.put('/receipt-storage', async (req, res) => {
    const body = req.body as { preference?: ReceiptStoragePreference | null };
    const pref = body.preference ?? null;
    if (pref !== null && pref !== 'kml' && pref !== 'drive') {
      return res.status(400).json({ error: 'preference must be "kml", "drive", or null' });
    }
    await getUserRepo(db).setReceiptStoragePreference(req.ctx!.userId, pref);
    res.json({ ok: true, preference: pref });
  });

  return router;
}
