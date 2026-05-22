import { Router, Request, Response } from 'express';
import passport from 'passport';
import { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';
import { AvailableProvider } from '../auth/passport';

/**
 * Authentication endpoints. Mounted at /api/auth and NOT behind requireUser.
 *
 *   GET  /api/auth/me                 → { user } or { user: null }
 *   POST /api/auth/logout             → destroys session
 *   GET  /api/auth/:provider          → kicks off OAuth flow
 *   GET  /api/auth/:provider/callback → completes flow, redirects to /
 */
export function authRouter(db: DbAdapter, providers: AvailableProvider[]): Router {
  const router = Router();
  const enabledIds = new Set(providers.map((p) => p.id));

  router.get('/me', async (req: Request, res: Response) => {
    const user = req.user as { id: string } | undefined;
    if (!user) return res.json({ user: null });
    const full = await getUserRepo(db).findById(user.id);
    res.json({ user: full ?? null });
  });

  router.post('/logout', (req: Request, res: Response, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session?.destroy(() => {
        res.json({ ok: true });
      });
    });
  });

  // Google
  if (enabledIds.has('google')) {
    router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

    router.get(
      '/google/callback',
      passport.authenticate('google', { failureRedirect: '/login?error=oauth' }),
      (_req, res) => res.redirect('/'),
    );
  }

  return router;
}
