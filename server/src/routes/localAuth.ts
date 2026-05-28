import { Router, Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import type { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';
import { welcomeEmail, passwordResetEmail, newUserSignupNotification } from '../services/emailService';
import { logSecurityEvent } from '../auth/auditLog';
import { validateBusinessName } from '../repos/businessName';

// Augment express-session with our MFA pending state.
declare module 'express-session' {
  interface SessionData {
    mfaPendingUserId?: string;
    mfaPendingExpires?: number;
  }
}

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3–30 characters: letters, numbers, _ or -';
  }
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// ── /api/auth/local/* ─────────────────────────────────────────────────────────
// Public routes: register, login, verify-mfa. No requireUser middleware.

export function localAuthRouter(db: DbAdapter): Router {
  const router = Router();

  /**
   * POST /api/auth/local/register
   * Body: { username, password, email, businessName, acceptTos }
   * Creates a new local-auth user, provisions defaults, and logs them in.
   */
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password, email, businessName, acceptTos } = req.body as {
        username?: string; password?: string; email?: string; businessName?: string; acceptTos?: boolean;
      };
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password required' });
      }
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }
      const businessNameCheck = validateBusinessName(businessName);
      if (!businessNameCheck.ok) {
        return res.status(400).json({ error: businessNameCheck.error });
      }
      if (!acceptTos) {
        return res.status(400).json({ error: 'You must accept the Terms of Service' });
      }
      const normalized = username.toLowerCase().trim();
      const normalizedEmail = email.toLowerCase().trim();
      const err = validateCredentials(normalized, password);
      if (err) return res.status(400).json({ error: err });

      const userRepo = getUserRepo(db);
      if (await userRepo.isUsernameTaken(normalized)) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      if (await userRepo.findByEmailCI(normalizedEmail)) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const tosAcceptedAt = new Date().toISOString();
      const user = await userRepo.createLocal(normalized, passwordHash, normalizedEmail, tosAcceptedAt);
      const { trialEndsAt } = await userRepo.provisionDefaults(user.id, businessNameCheck.name);

      // Send welcome email and internal signup notification (non-blocking).
      welcomeEmail(user.username ?? user.name ?? 'there', user.email!, trialEndsAt);
      newUserSignupNotification(user.username ?? user.name ?? 'there', user.email!, 'local');

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
        logSecurityEvent(db, { action: 'login_failure', payload: { reason: 'user_not_found' }, req });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await argon2.verify(record.passwordHash, password);
      if (!valid) {
        logSecurityEvent(db, { userId: record.userId, action: 'login_failure', payload: { reason: 'bad_password' }, req });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Check TOTP
      const totpRecord = await userRepo.getTotpRecord(record.userId);
      if (totpRecord?.enabled) {
        req.session.mfaPendingUserId = record.userId;
        req.session.mfaPendingExpires = Date.now() + 5 * 60 * 1000; // 5 min
        return res.json({ mfaRequired: true });
      }

      // No MFA; log in immediately.
      const user = await userRepo.findById(record.userId);
      await new Promise<void>((resolve, reject) => {
        req.login({ id: record.userId }, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
      });
      logSecurityEvent(db, { userId: record.userId, action: 'login_success', req });
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
        return res.status(401).json({ error: 'MFA session expired; please sign in again' });
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
      if (delta === null) {
        logSecurityEvent(db, { userId: pendingUserId, action: 'login_mfa_failure', req });
        return res.status(401).json({ error: 'Invalid or expired code' });
      }

      // Clear pending state before logging in.
      delete req.session.mfaPendingUserId;
      delete req.session.mfaPendingExpires;

      const user = await userRepo.findById(pendingUserId);
      await new Promise<void>((resolve, reject) => {
        req.login({ id: pendingUserId }, (loginErr) => (loginErr ? reject(loginErr) : resolve()));
      });
      logSecurityEvent(db, { userId: pendingUserId, action: 'login_mfa_success', req });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/auth/local/email
   * Body: { email }
   * Allows an already-authenticated local user to set or update their email.
   * Used by the legacy-account email-prompt banner for accounts created before
   * email was required at signup.
   */
  router.patch('/email', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUser = req.user as { id: string } | undefined;
      if (!authUser) return res.status(401).json({ error: 'Authentication required' });

      const { email } = req.body as { email?: string };
      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }
      const normalizedEmail = email.toLowerCase().trim();

      const userRepo = getUserRepo(db);
      const existing = await userRepo.findByEmailCI(normalizedEmail);
      if (existing && existing.id !== authUser.id) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }

      await userRepo.updateEmail(authUser.id, normalizedEmail);
      const updated = await userRepo.findById(authUser.id);
      logSecurityEvent(db, { userId: authUser.id, action: 'email_changed', req });
      res.json({ user: updated });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/local/forgot-password
   * Body: { email }
   * Generates a one-time reset link and emails it. Always returns 200 so
   * enumerating which emails are registered is not possible.
   */
  router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email || !EMAIL_RE.test(email)) {
        // Return 200 to avoid enumeration; just silently drop bad input.
        return res.status(200).json({ ok: true });
      }
      const normalizedEmail = email.toLowerCase().trim();
      const userRepo = getUserRepo(db);
      const user = await userRepo.findByEmailCI(normalizedEmail);

      if (user) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const tokenId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        await db.run(
          `INSERT INTO password_reset_tokens(id, user_id, token_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [tokenId, user.id, tokenHash, new Date().toISOString(), expiresAt],
        );

        const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
        const resetLink = `${appUrl}/reset-password?token=${rawToken}`;
        passwordResetEmail(user.name ?? user.username ?? 'there', normalizedEmail, resetLink);
        logSecurityEvent(db, { userId: user.id, action: 'password_reset_requested', req });
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/auth/local/reset-password
   * Body: { token, password }
   * Validates the reset token, rehashes the password, and invalidates the token.
   */
  router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password } = req.body as { token?: string; password?: string };
      if (!token || !password) {
        return res.status(400).json({ error: 'token and password required' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const row = await db.get<{
        id: string; user_id: string; expires_at: string; used_at: string | null;
      }>(
        `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`,
        [tokenHash],
      );

      if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Reset link is invalid or has expired' });
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx.run(
          `UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?`,
          [passwordHash, now, row.user_id],
        );
        await tx.run(
          `UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`,
          [now, row.id],
        );
      });

      logSecurityEvent(db, { userId: row.user_id, action: 'password_reset_completed', req });

      // Destroy the current session so any open session on this device is
      // terminated immediately after the password change.
      if (req.session) {
        req.session.destroy(() => { /* ignore */ });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ── /api/auth/totp/* ──────────────────────────────────────────────────────────
// Authenticated routes: all require an active session (wired with requireUser
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
      if (delta === null) return res.status(400).json({ error: 'Invalid code; check your authenticator app' });

      await userRepo.enableTotp(userId);
      logSecurityEvent(db, { userId, action: 'mfa_enabled', req });
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
      logSecurityEvent(db, { userId, action: 'mfa_disabled', req });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
