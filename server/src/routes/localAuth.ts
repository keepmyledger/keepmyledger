import { Router, Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import type { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';

// Augment express-session with our MFA pending state.
declare module 'express-session' {
  interface SessionData {
    mfaPendingUserId?: string;
    mfaPendingExpires?: number;
  }
}

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;

function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3–30 characters: letters, numbers, _ or -';
  }
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// ── /api/auth/local/* ─────────────────────────────────────────────────────────
// Public routes — register, login, verify-mfa. No requireUser middleware.

export function localAuthRouter(db: DbAdapter): Router {
  const router = Router();

  /**
   * POST /api/auth/local/register
   * Body: { username, password }
   * Creates a new local-auth user, provisions defaults, and logs them in.
   */
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
      }
      const normalized = username.toLowerCase().trim();
      const err = validateCredentials(normalized, password);
      if (err) return res.status(400).json({ error: err });

      const userRepo = getUserRepo(db);
      if (await userRepo.isUsernameTaken(normalized)) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await userRepo.createLocal(normalized, passwordHash);
      await userRepo.provisionDefaults(user.id);

      await new Promise<void>((resolve, reject) => {
        req.login({ id: user.id }, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
      });

      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/local/login
   * Body: { username, password }
   * Verifies credentials. If TOTP is active, returns { mfaRequired: true } and
   * stores a short-lived pending state in the session. Otherwise logs in directly.
   */
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
      }

      const userRepo = getUserRepo(db);
      const record = await userRepo.findByUsernameForAuth(username.toLowerCase().trim());

      if (!record) {
        // Constant-time guard: hash a dummy string even when user not found.
        await argon2.hash('__timing_protection__', { type: argon2.argon2id });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await argon2.verify(record.passwordHash, password);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      // Check TOTP
      const totpRecord = await userRepo.getTotpRecord(record.userId);
      if (totpRecord?.enabled) {
        req.session.mfaPendingUserId = record.userId;
        req.session.mfaPendingExpires = Date.now() + 5 * 60 * 1000; // 5 min
        return res.json({ mfaRequired: true });
      }

      // No MFA — log in immediately.
      const user = await userRepo.findById(record.userId);
      await new Promise<void>((resolve, reject) => {
        req.login({ id: record.userId }, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
      });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/local/verify-mfa
   * Body: { code }
   * Completes a login that was paused for TOTP verification.
   */
  router.post('/verify-mfa', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) return res.status(400).json({ error: 'code required' });

      const pendingUserId = req.session.mfaPendingUserId;
      const pendingExpires = req.session.mfaPendingExpires;
      if (!pendingUserId || !pendingExpires || Date.now() > pendingExpires) {
        return res.status(401).json({ error: 'MFA session expired — please sign in again' });
      }

      const userRepo = getUserRepo(db);
      const totpRecord = await userRepo.getTotpRecord(pendingUserId);
      if (!totpRecord?.enabled) {
        return res.status(401).json({ error: 'MFA not configured' });
      }

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpRecord.secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
      if (delta === null) return res.status(401).json({ error: 'Invalid or expired code' });

      // Clear pending state before logging in.
      delete req.session.mfaPendingUserId;
      delete req.session.mfaPendingExpires;

      const user = await userRepo.findById(pendingUserId);
      await new Promise<void>((resolve, reject) => {
        req.login({ id: pendingUserId }, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
      });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ── /api/auth/totp/* ──────────────────────────────────────────────────────────
// Authenticated routes — all require an active session (wired with requireUser
// middleware in index.ts).

export function totpRouter(db: DbAdapter): Router {
  const router = Router();

  /**
   * GET /api/auth/totp/status
   * Returns { enabled, hasSecret } for the logged-in user.
   */
  router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req.user as { id: string }).id;
      const record = await getUserRepo(db).getTotpRecord(userId);
      res.json({ enabled: record?.enabled ?? false, hasSecret: !!record });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/auth/totp/setup
   * Generates (or regenerates) a TOTP secret and returns the QR code data URL.
   * The secret is stored but NOT enabled until /enable is called with a valid code.
   */
  router.get('/setup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req.user as { id: string }).id;
      const userRepo = getUserRepo(db);
      const user = await userRepo.findById(userId);

      const secret = new OTPAuth.Secret();
      const totp = new OTPAuth.TOTP({
        issuer: 'KeepMyLedger',
        label: user?.username ?? user?.name ?? user?.email ?? userId,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret,
      });

      await userRepo.setTotpSecret(userId, secret.base32);

      const otpauthUrl = totp.toString();
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

      res.json({ secret: secret.base32, otpauthUrl, qrCodeDataUrl });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/totp/enable
   * Body: { code }
   * Verifies the code against the stored (not-yet-enabled) secret, then activates TOTP.
   */
  router.post('/enable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req.user as { id: string }).id;
      const { code } = req.body as { code?: string };
      if (!code) return res.status(400).json({ error: 'code required' });

      const userRepo = getUserRepo(db);
      const record = await userRepo.getTotpRecord(userId);
      if (!record) return res.status(400).json({ error: 'Run /setup first to generate a secret' });

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(record.secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
      if (delta === null) return res.status(400).json({ error: 'Invalid code — check your authenticator app' });

      await userRepo.enableTotp(userId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/totp/disable
   * Body: { code }
   * Requires a valid TOTP code to disable two-factor auth.
   */
  router.post('/disable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req.user as { id: string }).id;
      const { code } = req.body as { code?: string };
      if (!code) return res.status(400).json({ error: 'code required' });

      const userRepo = getUserRepo(db);
      const record = await userRepo.getTotpRecord(userId);
      if (!record?.enabled) return res.status(400).json({ error: 'TOTP is not currently enabled' });

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(record.secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
      if (delta === null) return res.status(400).json({ error: 'Invalid code' });

      await userRepo.disableTotp(userId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
