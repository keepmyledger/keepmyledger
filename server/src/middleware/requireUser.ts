import { Request, Response, NextFunction, RequestHandler } from 'express';
import { DbAdapter } from '../db/adapter';
import { buildContext, getAppMode, getUserRepo, OWNER_USER_ID, RequestContext } from '../auth/context';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

/**
 * Resolves the current user + active business/org from the session and
 * x-business-id header. Attaches a fully-built `RequestContext` to `req.ctx`.
 *
 * Business resolution:
 *   1. If x-business-id header is present, verify the user has membership in
 *      the org that owns that business and use it.
 *   2. Otherwise, fall back to the user's first business (personal org).
 *
 * Responds 401 when the user is not authenticated and 403 when the user is not
 * a member of the org that owns the requested business.
 */
export function requireUser(db: DbAdapter): RequestHandler {
  const mode = getAppMode();
  const userRepo = getUserRepo(db);

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        let userId: string | undefined;

        if (mode === 'saas') {
          const passportUser = (req as Request & { user?: { id?: string } }).user;
          userId = passportUser?.id ?? (req.header('x-user-id') ?? undefined);
          if (!userId) {
            res.status(401).json({ error: 'Authentication required' });
            return;
          }
          const found = await userRepo.findById(userId);
          if (!found) {
            res.status(401).json({ error: 'Unknown user' });
            return;
          }
          await userRepo.syncAdminStatus(found.id, found.email);
        } else {
          userId = OWNER_USER_ID;
          await userRepo.getOwner();
        }

        // Resolve active business + org + role
        const businessIdHeader = req.header('x-business-id');
        let orgId: string;
        let businessId: number;
        let role: 'owner' | 'member';

        if (businessIdHeader) {
          const bizId = Number(businessIdHeader);
          if (!Number.isInteger(bizId) || bizId <= 0) {
            res.status(400).json({ error: 'Invalid x-business-id header' });
            return;
          }
          // Verify the user is a member of the org that owns this business.
          const row = await db.get<{ org_id: string; role: string }>(
            `SELECT m.org_id, m.role
             FROM org_memberships m
             JOIN businesses b ON b.org_id = m.org_id
             WHERE b.id = ? AND m.user_id = ?`,
            [bizId, userId],
          );
          if (!row) {
            res.status(403).json({ error: 'Forbidden: not a member of this business' });
            return;
          }
          orgId = row.org_id;
          businessId = bizId;
          role = row.role as 'owner' | 'member';
        } else {
          // Fall back to the user's first business (personal org)
          const row = await db.get<{ id: number; org_id: string; role: string }>(
            `SELECT b.id, m.org_id, m.role
             FROM businesses b
             JOIN org_memberships m ON m.org_id = b.org_id
             WHERE m.user_id = ?
             ORDER BY b.id ASC
             LIMIT 1`,
            [userId],
          );
          if (!row) {
            // New user: provisionDefaults hasn't run yet (race condition) — respond 503
            res.status(503).json({ error: 'User setup incomplete, please retry shortly' });
            return;
          }
          orgId = row.org_id;
          businessId = Number(row.id);
          role = row.role as 'owner' | 'member';
        }

        req.ctx = buildContext(db, userId, orgId, businessId, role);
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
