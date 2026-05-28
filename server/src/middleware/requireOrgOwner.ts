import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Requires the authenticated user to be an owner of the active org.
 * Must be used after `requireUser`.
 */
export function requireOrgOwner(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.ctx?.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden: org owner required' });
      return;
    }
    next();
  };
}
