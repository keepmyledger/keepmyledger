import express, { Router, Request, Response } from 'express';
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

  // Microsoft (Identity Platform v2.0). Scopes are configured on the strategy,
  // so the initiator doesn't need to repeat them. Callback is a GET — Microsoft
  // uses query-string response mode by default, so the session cookie rides
  // along normally (unlike Apple's cross-site POST).
  if (enabledIds.has('microsoft')) {
    router.get('/microsoft', passport.authenticate('microsoft'));

    router.get(
      '/microsoft/callback',
      passport.authenticate('microsoft', { failureRedirect: '/login?error=oauth' }),
      (_req, res) => res.redirect('/'),
    );
  }

  // Apple
  // The callback is POST because Apple uses response_mode=form_post.
  // Apple sends a JSON `user` field in the body only on first authorization;
  // the strategy in auth/apple.ts reads it off req.body.
  if (enabledIds.has('apple')) {
    router.get('/apple', passport.authenticate('apple', { scope: ['name', 'email'] }));

    router.post(
      '/apple/callback',
      express.urlencoded({ extended: true }), // Apple uses response_mode=form_post
      passport.authenticate('apple', { failureRedirect: '/login?error=oauth' }),
      (_req, res) => res.redirect('/'),
    );
  }

  return router;
}
