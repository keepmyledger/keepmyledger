import { Router, Request, Response } from 'express';
import type { DbAdapter } from '../db/adapter';
import { requireUser } from '../middleware/requireUser';
import { requireAdmin } from '../middleware/requireAdmin';
import { decryptNullable } from '../auth/crypto';
import { hashEmail } from '../auth/emailHash';
import { logSecurityEvent } from '../auth/auditLog';
import { UnknownFormatSampleRepoImpl } from '../repos/impl/UnknownFormatSampleRepoImpl';
import type { UnknownFormatStatus } from '../repos/UnknownFormatSampleRepo';
import type { SubscriptionTier } from '../repos/SubscriptionRepo';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mask an email address so PII is not exposed in list views.
 * brian@example.com  →  b***@example.com
 * Admins must explicitly call the reveal endpoint to see the real address.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return email[0] + '***' + email.slice(at);
}

/** Build a date expression for "N days ago" in the right SQL dialect.
 *  Both backends store timestamps as TEXT in `YYYY-MM-DD HH24:MI:SS` UTC
 *  (see migrations-pg/001_init.sql header), so the pg branch must also
 *  return TEXT — otherwise `text_col >= timestamptz` errors out. */
function daysAgo(db: DbAdapter, n: number): string {
  return db.backend === 'pg'
    ? `to_char((now() - INTERVAL '${n} days') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`
    : `datetime('now', '-${n} days')`;
}

/** Build a "truncate to day" expression for time-series grouping. */
function dateOf(db: DbAdapter, col: string): string {
  return db.backend === 'pg'
    ? `(${col}::date)::text`
    : `date(${col})`;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function adminRouter(db: DbAdapter): Router {
  const router = Router();
  const auth = [requireUser(db), requireAdmin(db)];

  // ── GET /api/admin/stats/overview ─────────────────────────────────────────
  router.get('/stats/overview', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const [
          userRow,
          new7Row,
          new30Row,
          txRow,
          stmtRow,
          subRows,
          aiTodayRow,
          ai30Row,
        ] = await Promise.all([
          db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM users WHERE NOT is_admin`),
          db.get<{ total: number }>(
            `SELECT COUNT(*) AS total FROM users WHERE NOT is_admin AND created_at >= ${daysAgo(db, 7)}`,
          ),
          db.get<{ total: number }>(
            `SELECT COUNT(*) AS total FROM users WHERE NOT is_admin AND created_at >= ${daysAgo(db, 30)}`,
          ),
          db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM transactions`),
          db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM statements`),
          db.all<{ status: string | null; total: number }>(
            `SELECT status, COUNT(*) AS total FROM subscriptions GROUP BY status`,
          ),
          db.get<{ total: number }>(
            db.backend === 'pg'
              ? `SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE day = CURRENT_DATE::text`
              : `SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE day = date('now')`,
          ),
          db.get<{ total: number }>(
            db.backend === 'pg'
              ? `SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE day >= (CURRENT_DATE - INTERVAL '30 days')::text`
              : `SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE day >= date('now', '-30 days')`,
          ),
        ]);

        const subMap: Record<string, number> = {};
        for (const row of subRows) subMap[row.status ?? 'null'] = Number(row.total);

        res.json({
          totalUsers:      Number(userRow?.total ?? 0),
          newUsers7d:      Number(new7Row?.total ?? 0),
          newUsers30d:     Number(new30Row?.total ?? 0),
          totalTransactions: Number(txRow?.total ?? 0),
          totalStatements: Number(stmtRow?.total ?? 0),
          subscriptions:   subMap,
          aiCallsToday:    Number(aiTodayRow?.total ?? 0),
          aiCalls30d:      Number(ai30Row?.total ?? 0),
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── GET /api/admin/stats/signups?days=30 ──────────────────────────────────
  router.get('/stats/signups', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
        const rows = await db.all<{ day: string; total: number }>(
          `SELECT ${dateOf(db, 'created_at')} AS day, COUNT(*) AS total
           FROM users
           WHERE NOT is_admin AND created_at >= ${daysAgo(db, days)}
           GROUP BY ${dateOf(db, 'created_at')}
           ORDER BY day`,
        );
        res.json(rows.map(r => ({ day: r.day, total: Number(r.total) })));
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── GET /api/admin/stats/imports?days=30 ─────────────────────────────────
  router.get('/stats/imports', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
        // `statements` uses `imported_at`, not `created_at`.
        const rows = await db.all<{ day: string; total: number }>(
          `SELECT ${dateOf(db, 'imported_at')} AS day, COUNT(*) AS total
           FROM statements
           WHERE imported_at >= ${daysAgo(db, days)}
           GROUP BY ${dateOf(db, 'imported_at')}
           ORDER BY day`,
        );
        res.json(rows.map(r => ({ day: r.day, total: Number(r.total) })));
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── GET /api/admin/users?q=&trialEndingDays= ─────────────────────────────
  router.get('/users', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const q = (req.query.q as string | undefined)?.toLowerCase() ?? '';
        const trialEndingDays = req.query.trialEndingDays ? Number(req.query.trialEndingDays) : null;
        const page  = Math.max(1, Number(req.query.page  ?? 1));
        const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
        const offset = (page - 1) * limit;

        let where = 'WHERE NOT u.is_admin';
        const params: unknown[] = [];

        if (q) {
          // PR #66 dropped plaintext email/name; encrypted columns can't be
          // substring-searched. Trade-off: exact email match (via email_hash)
          // when the query looks like an email; otherwise LIKE on username
          // (still plaintext). Name search is dropped — admins can use
          // /reveal-email to confirm a specific candidate.
          if (q.includes('@')) {
            where += ` AND u.email_hash = ?`;
            params.push(hashEmail(q));
          } else {
            where += ` AND LOWER(u.username) LIKE ?`;
            params.push(`%${q}%`);
          }
        }
        if (trialEndingDays !== null) {
          const cutoff = trialEndingDays === 0
            ? (db.backend === 'pg' ? `NOW()` : `datetime('now')`)
            : (db.backend === 'pg'
              ? `NOW() + INTERVAL '${trialEndingDays} days'`
              : `datetime('now', '+${trialEndingDays} days')`);
          where += ` AND s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= ${cutoff}`;
        }

        const countSql = `
          SELECT COUNT(*) AS total
          FROM users u
          LEFT JOIN subscriptions s ON s.org_id = u.id
          ${where}`;
        const rowsSql = `
          SELECT u.id, u.email_enc, u.name_enc, u.username, u.created_at,
                 s.status AS sub_status, s.trial_ends_at,
                 s.tier, s.seats, s.granted_by_admin_id
          FROM users u
          LEFT JOIN subscriptions s ON s.org_id = u.id
          ${where}
          ORDER BY u.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`;

        const [countRow, rows] = await Promise.all([
          db.get<{ total: number }>(countSql, params),
          db.all<Record<string, unknown>>(rowsSql, params),
        ]);

        res.json({
          total: Number(countRow?.total ?? 0),
          page,
          limit,
          users: rows.map(r => ({
            id:               r.id as string,
            email:            maskEmail(decryptNullable(r.email_enc as string | null)),
            name:             decryptNullable(r.name_enc as string | null),
            username:         r.username as string | null,
            createdAt:        r.created_at as string,
            subStatus:        r.sub_status as string | null,
            trialEndsAt:      r.trial_ends_at as string | null,
            tier:             (r.tier as string | null) ?? 'free',
            seats:            r.seats != null ? Number(r.seats) : 1,
            grantedByAdminId: r.granted_by_admin_id as string | null,
          })),
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── GET /api/admin/users/:id/reveal-email ────────────────────────────────
  // Returns the real (unmasked) email for a single user and records the access
  // in admin_audit_log so reveals are auditable.
  router.get('/users/:id/reveal-email', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const targetId = req.params.id;
        const actorId = req.ctx!.userId;

        const row = await db.get<{ email_enc: string | null }>(
          `SELECT email_enc FROM users WHERE id = ?`,
          [targetId],
        );
        if (!row) return res.status(404).json({ error: 'User not found' });

        await db.run(
          `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, payload_json)
           VALUES (?, 'reveal_user_email', 'user', ?, ?)`,
          [actorId, targetId, JSON.stringify({})],
        );

        res.json({ email: decryptNullable(row.email_enc) });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── POST /api/admin/users/:id/grant-tier ─────────────────────────────────
  // Sets status='active', plan='admin_grant', tier, seats for a user without
  // going through Stripe. Refuses if the user already has an active Stripe sub.
  router.post('/users/:id/grant-tier', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const userId = req.params.id;
        const { tier, seats } = req.body as { tier?: unknown; seats?: unknown };

        const validTiers: SubscriptionTier[] = ['business', 'org'];
        if (!tier || !validTiers.includes(tier as SubscriptionTier)) {
          return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
        }
        const grantTier = tier as SubscriptionTier;
        const grantSeats = grantTier === 'org'
          ? (typeof seats === 'number' && seats >= 1 ? Math.floor(seats) : 3)
          : 1;

        // Resolve the user's personal org (org_id = user_id by convention).
        const user = await db.get<{ id: string }>(
          'SELECT id FROM users WHERE id = ?', [userId],
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Fetch current subscription; refuse if an active Stripe sub exists.
        const sub = await db.get<{ stripe_subscription_id: string | null }>(
          'SELECT stripe_subscription_id FROM subscriptions WHERE org_id = ?', [userId],
        );
        if (sub?.stripe_subscription_id) {
          return res.status(409).json({
            error: 'User has an active Stripe subscription. Cancel it before granting an admin tier.',
          });
        }

        const now = new Date().toISOString();
        const adminId = req.ctx!.userId;

        if (sub) {
          // Preserve trial_ends_at so revoke can restore the user to
          // 'trialing' if the original trial is still unexpired.
          await db.run(
            `UPDATE subscriptions
             SET status = 'active', plan = 'admin_grant', tier = ?,
                 seats = ?, granted_by_admin_id = ?, granted_at = ?,
                 current_period_end = NULL,
                 updated_at = ?
             WHERE org_id = ?`,
            [grantTier, grantSeats, adminId, now, now, userId],
          );
        } else {
          await db.run(
            `INSERT INTO subscriptions
               (org_id, status, plan, tier, seats, granted_by_admin_id, granted_at, created_at, updated_at)
             VALUES (?, 'active', 'admin_grant', ?, ?, ?, ?, ?, ?)`,
            [userId, grantTier, grantSeats, adminId, now, now, now],
          );
        }

        logSecurityEvent(db, {
          userId: adminId,
          action: 'admin_grant_tier',
          payload: { targetUserId: userId, tier: grantTier, seats: grantSeats },
        });

        res.json({ ok: true, userId, tier: grantTier, seats: grantSeats });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── POST /api/admin/users/:id/revoke-grant ────────────────────────────────
  // Reverts an admin-granted tier. Falls back to trialing if trial still valid,
  // otherwise canceled.
  router.post('/users/:id/revoke-grant', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const userId = req.params.id;

        const sub = await db.get<{
          plan: string;
          trial_ends_at: string | null;
        }>(
          'SELECT plan, trial_ends_at FROM subscriptions WHERE org_id = ?', [userId],
        );
        if (!sub) return res.status(404).json({ error: 'No subscription found for user' });
        if (sub.plan !== 'admin_grant') {
          return res.status(400).json({ error: 'Subscription was not admin-granted; cannot revoke' });
        }

        const now = new Date();
        const trialActive = sub.trial_ends_at && new Date(sub.trial_ends_at) > now;
        const newStatus = trialActive ? 'trialing' : 'canceled';

        // Clear all grant-related fields on revoke, including granted_at.
        // Note: if the grantor's user row is later deleted, granted_by_admin_id
        // is set NULL by the FK ON DELETE SET NULL constraint, but granted_at
        // is not automatically cleared — that column records when the grant was
        // issued, not who issued it, so it's treated as historical audit data.
        // A revoke (this path) clears both fields explicitly.
        await db.run(
          `UPDATE subscriptions
           SET status = ?, plan = 'revoked', tier = 'free', seats = 1,
               granted_by_admin_id = NULL, granted_at = NULL,
               updated_at = ?
           WHERE org_id = ?`,
          [newStatus, now.toISOString(), userId],
        );

        logSecurityEvent(db, {
          userId: req.ctx!.userId,
          action: 'admin_revoke_grant',
          payload: { targetUserId: userId, newStatus },
        });

        res.json({ ok: true, userId, status: newStatus });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── POST /api/admin/users/extend-trial ───────────────────────────────────
  router.post('/users/extend-trial', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const { userIds, days, reason } = req.body as {
          userIds: string[];
          days: number;
          reason?: string;
        };

        if (!Array.isArray(userIds) || userIds.length === 0) {
          return res.status(400).json({ error: 'userIds must be a non-empty array' });
        }
        if (typeof days !== 'number' || days < 1 || days > 365) {
          return res.status(400).json({ error: 'days must be between 1 and 365' });
        }

        const actorId = req.ctx!.userId;

        await db.transaction(async tx => {
          for (const userId of userIds) {
            // Extend or set trial_ends_at: max(now, current trial_ends_at) + days
            const extendSql = db.backend === 'pg'
              ? `UPDATE subscriptions
                 SET trial_ends_at = (GREATEST(COALESCE(trial_ends_at::timestamptz, NOW()), NOW()) + INTERVAL '${days} days')::text,
                     status = 'trialing'
                 WHERE org_id = ?`
              : `UPDATE subscriptions
                 SET trial_ends_at = datetime(MAX(COALESCE(trial_ends_at, datetime('now')), datetime('now')), '+${days} days'),
                     status = 'trialing'
                 WHERE org_id = ?`;

            const result = await tx.run(extendSql, [userId]);

            // If no subscription row exists yet, create one
            if (result.changes === 0) {
              const newTrialEnd = db.backend === 'pg'
                ? `(NOW() + INTERVAL '${days} days')::text`
                : `datetime('now', '+${days} days')`;
              // Personal org id = userId by convention (see UserRepoImpl.provisionDefaults).
              await tx.run(
                `INSERT INTO subscriptions (org_id, status, trial_ends_at)
                 VALUES (?, 'trialing', ${newTrialEnd})`,
                [userId],
              );
            }

            // Audit log
            await tx.run(
              `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, payload_json)
               VALUES (?, 'extend_trial', 'user', ?, ?)`,
              [actorId, userId, JSON.stringify({ days, reason: reason ?? null })],
            );
          }
        });

        res.json({ ok: true, extended: userIds.length });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── GET /api/admin/unknown-formats ───────────────────────────────────────
  router.get('/unknown-formats', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const VALID_STATUSES: UnknownFormatStatus[] = ['pending', 'in_progress', 'done', 'wont_implement'];
        const statusParam = req.query.status as string | undefined;
        const status = statusParam && (VALID_STATUSES as string[]).includes(statusParam)
          ? (statusParam as UnknownFormatStatus)
          : undefined;
        const page  = Math.max(1, Number(req.query.page  ?? 1));
        const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
        const offset = (page - 1) * limit;

        const repo = new UnknownFormatSampleRepoImpl(db);
        const { rows, total } = await repo.list({ status, limit, offset });
        res.json({ total, page, limit, samples: rows });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  // ── PATCH /api/admin/unknown-formats/:id ─────────────────────────────────
  router.patch('/unknown-formats/:id', ...auth, (req: Request, res: Response) => {
    void (async () => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

        const VALID_STATUSES: UnknownFormatStatus[] = ['pending', 'in_progress', 'done', 'wont_implement'];
        const { status, adminNotes } = req.body as { status?: string; adminNotes?: string | null };

        if (status !== undefined && !(VALID_STATUSES as string[]).includes(status)) {
          return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        const repo = new UnknownFormatSampleRepoImpl(db);
        const updated = await repo.update(id, {
          status: status as UnknownFormatStatus | undefined,
          adminNotes,
        });
        if (!updated) return res.status(404).json({ error: 'Sample not found' });
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })();
  });

  return router;
}
