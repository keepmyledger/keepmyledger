import { Request, Response, NextFunction, RequestHandler } from 'express';
import { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';

/**
 * Middleware that requires the authenticated user to have is_admin = true.
 * Must be used *after* requireUser (which attaches req.ctx).
 */
export function requireAdmin(db: DbAdapter): RequestHandler {
  const userRepo = getUserRepo(db);
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const userId = req.ctx?.userId;
        if (!userId) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }
        const user = await userRepo.findById(userId);
        if (!user?.isAdmin) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
