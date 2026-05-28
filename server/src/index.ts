import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import passport from 'passport';
import { createSessionStore } from './auth/sessionStore';

// Load .env from server/ (parent of dist/) before anything reads env vars
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { openDatabase } from './db/migrate';
import { openPgDatabase } from './db/migratePg';
import { SqliteAdapter } from './db/adapter/SqliteAdapter';
import { PgAdapter } from './db/adapter/PgAdapter';
import type { DbAdapter } from './db/adapter';
import { DriveService } from './services/driveService';
import { s3StorageFromEnv } from './services/storage/S3Storage';
import { getDefaultReceiptStorage } from './services/storage/preference';
import { requireUser } from './middleware/requireUser';
import { getAppMode, getUserRepo } from './auth/context';
import { initPassport } from './auth/passport';
import { isLlmConfigured } from './llm/client';

import { authRouter } from './routes/auth';
import { localAuthRouter, totpRouter } from './routes/localAuth';
import { accountsRouter } from './routes/accounts';
import { categoriesRouter } from './routes/categories';
import { rulesRouter } from './routes/rules';
import { transactionsRouter } from './routes/transactions';
import { importsRouter } from './routes/imports';
import { reportsRouter, startupRouter, exportsRouter } from './routes/reports';
import { receiptsRouter } from './routes/receipts';
import { billingRouter, devBillingRouter, stripeWebhookHandler } from './routes/billing';
import { createEmailWebhookRouter } from './routes/emailWebhook';
import { accountRouter } from './routes/account';
import { adminRouter } from './routes/admin';
import { orgsRouter } from './routes/orgs';
import invitesRouter, { publicInvitesRouter } from './routes/invites';
import { isStripeConfigured } from './services/stripeService';
import { requireActiveSubscription } from './middleware/requireActiveSubscription';
import { startScheduler } from './scheduler';
import { initEmailService } from './services/emailService';
import * as Sentry from '@sentry/node';

const PORT = Number(process.env.PORT ?? 3001);
function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(process.cwd(), 'data', 'keepmyledger.db');
}
const DB_PATH = resolveDbPath();
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me';

// ── Database (singleton) ─────────────────────────────────────────────────────
// Backend selection: DATABASE_URL (postgres://...) → PG, else sqlite file.
async function initDb(): Promise<{ db: DbAdapter; pgPool: Pool | null }> {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('postgres')) {
    const pool = await openPgDatabase(url);
    console.log(`[db] backend=pg`);
    return { db: new PgAdapter(pool), pgPool: pool };
  }
  console.log(`[db] backend=sqlite path=${DB_PATH}`);
  return { db: new SqliteAdapter(openDatabase(DB_PATH)), pgPool: null };
}

async function bootstrap(): Promise<void> {
  // ── Sentry (error tracking) ─────────────────────────────────────────────────
  // Init before any async work so uncaught exceptions are captured.
  Sentry.init({
    dsn: process.env.SENTRY_DSN_SERVER,
    environment: process.env.NODE_ENV ?? 'development',
    enabled: !!process.env.SENTRY_DSN_SERVER,
  });

  const { db, pgPool } = await initDb();
  const userRepo = getUserRepo(db);

  // ── Auth: passport strategies (provider list driven by env vars) ─────────────
  const providers = initPassport(db, userRepo);

  // ── Globally-scoped services ─────────────────────────────────────────────────
  const driveService = new DriveService(db);
  const objectStorage = s3StorageFromEnv();
  if (objectStorage) console.log('[storage] S3-compatible object storage enabled');

  // ── Express app ──────────────────────────────────────────────────────────────
  const app = express();
  // Behind Nginx/ALB in production, trust X-Forwarded-* so secure session
  // cookies survive OAuth redirects over HTTPS.
  app.set('trust proxy', 1);

  // Security headers with CSP.
  // style-src includes 'unsafe-inline' because the React app uses inline styles throughout.
  // Stripe needs its own script/frame origins; Sentry ingest is added when configured.
  // HSTS: 2-year max-age + includeSubDomains + preload (production only; submit to
  // https://hstspreload.org once the domain is stable).
  const isProduction = process.env.NODE_ENV === 'production';
  const sentryConnectSrc = process.env.SENTRY_DSN_SERVER ? ['https://*.ingest.sentry.io'] : [];
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:       ["'self'"],
        scriptSrc:        ["'self'", 'https://js.stripe.com'],
        styleSrc:         ["'self'", "'unsafe-inline'"],
        imgSrc:           ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc:       ["'self'", 'https://api.stripe.com', ...sentryConnectSrc],
        frameSrc:         ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
        frameAncestors:   ["'none'"],
        objectSrc:        ["'none'"],
        baseUri:          ["'self'"],
        formAction:       ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // 2 years, includeSubDomains, preload — production only (preload requires HTTPS on all subdomains).
    hsts: isProduction
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
  }));

  // Global rate limit: 300 requests/min per IP. Prevents basic scraping /
  // enumeration without blocking normal interactive use.
  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down' },
  }));

  // Stripe webhook: must receive the raw body for signature verification.
  // IMPORTANT: mount BEFORE express.json() so the Buffer is not parsed away.
  if (isStripeConfigured()) {
    app.post(
      '/api/billing/webhook',
      express.raw({ type: 'application/json' }),
      stripeWebhookHandler(db),
    );
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session store: driver chosen via `auth/sessionStore` factory.
  // `express-session.Store` is the migration boundary; swap in Redis /
  // DynamoDB / etc. by adding a case in that module; no changes here.
  const { store: sessionStore, driver: sessionDriver } = createSessionStore({ db, pgPool });
  if (sessionDriver === 'memory' && getAppMode() === 'saas') {
    console.error(
      '[session] FATAL: memory store in SaaS mode — sessions will not survive restarts ' +
        'or multi-instance deploys. Set DATABASE_URL or SESSION_STORE and restart.',
    );
    process.exit(1);
  }
  console.log(`[session] store=${sessionDriver}`);

  app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // Named cookie avoids the default 'connect.sid' fingerprint that reveals
    // Express/connect to passive network observers.
    name: 'kml.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // ── Public config (no auth) ──────────────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config', (_req, res) => {
    const kmlStorageAvailable = !!objectStorage;
    const gaMeasurementId = process.env.GA_MEASUREMENT_ID?.trim() || null;
    res.json({
      mode: getAppMode(),
      providers: providers.map((p) => ({ id: p.id, label: p.label })),
      billingEnabled: isStripeConfigured(),
      aiAssistEnabled: isLlmConfigured(),
      kmlStorageAvailable,
      defaultReceiptStorage: getDefaultReceiptStorage(kmlStorageAvailable),
      gaMeasurementId,
    });
  });

  // Public webhook: SNS/SES bounce & complaint notifications (no auth).
  app.use('/api/email', createEmailWebhookRouter(db));

  // Auth endpoints (no requireUser); these are how you become authenticated.
  // Strict rate limit on local auth to limit brute-force and credential stuffing.
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please wait a minute and try again' },
  });
  // Extra-strict limit on password-reset and MFA-verify endpoints (5/min per IP).
  // These are the highest-value brute-force targets; lower threshold is acceptable
  // because legitimate users hit them rarely.
  const strictAuthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please wait a minute and try again' },
  });
  app.use('/api/auth/local/verify-mfa',     strictAuthLimiter);
  app.use('/api/auth/local/forgot-password', strictAuthLimiter);
  app.use('/api/auth/local/reset-password',  strictAuthLimiter);
  app.use('/api/auth/local', authLimiter, localAuthRouter(db));
  app.use('/api/auth', authRouter(db, providers));

  // ── Authenticated API routes ─────────────────────────────────────────────────
  const auth = requireUser(db);
  const activeSub = requireActiveSubscription();

  // TOTP management: requires an active session; rate-limited to slow code-guessing.
  app.use('/api/auth/totp', authLimiter, auth, totpRouter(db));

  // Billing: no subscription gate on billing itself (users need to check status
  // and manage their subscription even when expired).
  app.use('/api/billing',       auth, billingRouter(db));
  app.use('/api/orgs',          auth, orgsRouter({ storage: objectStorage }));
  app.use('/api/orgs/:orgId/invites', auth, invitesRouter);
  app.use('/api/invites',       auth, publicInvitesRouter(db));

  // Account self-service: data export and account deletion.
  app.use('/api/account',       auth, accountRouter(db));
  app.use('/api/admin',          adminRouter(db));

  // Dev-only override (DEV_TOOLS=1); empty router when disabled.
  app.use('/api/dev',           auth, devBillingRouter());

  app.use('/api/accounts',      auth, activeSub, accountsRouter());
  app.use('/api/categories',    auth, categoriesRouter());
  app.use('/api/rules',         auth, activeSub, rulesRouter());
  app.use('/api/transactions',  auth, transactionsRouter());
  app.use('/api/imports',       auth, activeSub, importsRouter(db));
  app.use('/api/receipts',      auth, receiptsRouter({ db, drive: driveService, storage: objectStorage }));
  app.use('/api/reports',       auth, reportsRouter());
  app.use('/api/exports',       auth, exportsRouter());
  app.use('/api/startup-check', auth, startupRouter());

  // ── Static SPA ───────────────────────────────────────────────────────────────
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');

  // Marketing/legal routes are pre-rendered at build time (web/scripts/prerender.ts)
  // to make them crawlable by search engines and AI answer engines. Serve the
  // baked-in HTML directly so crawlers don't see a 301 hop on the bare path.
  // These must come before express.static so they win over its directory-redirect
  // behavior.
  const PRERENDERED_ROUTES = ['/about', '/privacy', '/terms', '/accessibility'];
  for (const route of PRERENDERED_ROUTES) {
    app.get(route, (_req, res, next) => {
      res.sendFile(path.join(webDist, route.slice(1), 'index.html'), (err) => {
        if (err) next();
      });
    });
  }

  app.use(express.static(webDist));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Web app not built yet. Run: npm run build -w web');
    });
  });

  // ── Error handler ────────────────────────────────────────────────────────────
  // Sentry must come before the generic handler to capture errors.
  Sentry.setupExpressErrorHandler(app);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err.message);
    res.status(500).json({ error: err.message });
  });

  // ── Start ────────────────────────────────────────────────────────────────────
  // Bind on 127.0.0.1 by default (safer for local dev). Set HOST=0.0.0.0 in
  // containers / hosted environments where the platform routes external
  // traffic in.
  const HOST = process.env.HOST ?? '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    const providerNames = providers.length ? providers.map((p) => p.id).join(',') : 'none';
    console.log(`[server] running at http://${HOST}:${PORT} (mode=${getAppMode()}, oauth=${providerNames})`);
  });

  // Start background scheduler (trial-ending reminders, etc.)
  startScheduler(db);
  // Wire DB into email service for suppression checks.
  initEmailService(db);

  // Graceful shutdown so PG connections drain cleanly.
  const shutdown = async (sig: string) => {
    console.log(`[shutdown] received ${sig}, closing...`);
    server.close();
    try { await db.close?.(); } catch (e) { console.error('[shutdown] db.close failed', e); }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[bootstrap] FAILED:', err);
  process.exit(1);
});
