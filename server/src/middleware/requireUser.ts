import { Request, Response, NextFunction, RequestHandler } from 'express';
import { DbAdapter } from '../db/adapter';
import { buildContext, getAppMode, getUserRepo, OWNER_USER_ID, RequestContext } from '../auth/context';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

/**
 * Resolves the current user from the session (saas mode) or implicitly maps to
 * the singleton "owner" user (selfhost mode). Attaches a fully-built
 * `RequestContext` (repos + services) to `req.ctx`.
 *
 * In saas mode without a session cookie, responds 401. OAuth wiring will
 * populate the session in a later phase; for now selfhost is the default.
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
          if (!(await userRepo.findById(userId))) {
            res.status(401).json({ error: 'Unknown user' });
            return;
          }
        } else {
          userId = OWNER_USER_ID;
          await userRepo.getOwner();
        }

        req.ctx = buildContext(db, userId);
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
