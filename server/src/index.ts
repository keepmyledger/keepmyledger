import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
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
import { billingRouter, devBillingRouter } from './routes/billing';
import { requireActiveSubscription } from './middleware/requireActiveSubscription';

const PORT = Number(process.env.PORT ?? 3001);
function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dataDir = path.join(process.cwd(), 'data');
  const newPath = path.join(dataDir, 'keepmyledger.db');
  const legacyPath = path.join(dataDir, 'expense-tracker.db');
  // Prefer existing new file; otherwise fall back to legacy if present; else default to new.
  if (fs.existsSync(newPath)) return newPath;
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
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
  const { db, pgPool } = await initDb();
  const userRepo = getUserRepo(db);

  // ── Auth: passport strategies (provider list driven by env vars) ─────────────
  const providers = initPassport(db, userRepo);

  // ── Globally-scoped services ─────────────────────────────────────────────────
  const driveService = new DriveService(db);

  // ── Express app ──────────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session store: driver chosen via `auth/sessionStore` factory.
  // `express-session.Store` is the migration boundary — swap in Redis /
  // DynamoDB / etc. by adding a case in that module; no changes here.
  const { store: sessionStore, driver: sessionDriver } = createSessionStore({ db, pgPool });
  if (sessionDriver === 'memory' && getAppMode() === 'saas') {
    console.warn(
      '[session] WARNING: memory store in SaaS mode — sessions will not survive ' +
        'restarts or multi-instance deploys. Set DATABASE_URL or SESSION_STORE.',
    );
  } else {
    console.log(`[session] store=${sessionDriver}`);
  }

  app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
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
    res.json({
      mode: getAppMode(),
      providers: providers.map((p) => ({ id: p.id, label: p.label })),
      billingEnabled: false, // Stripe wires in next phase
      aiAssistEnabled: isLlmConfigured(),
    });
  });

  // Auth endpoints (no requireUser — these are how you become authenticated)
  app.use('/api/auth/local', localAuthRouter(db));
  app.use('/api/auth', authRouter(db, providers));

  // ── Authenticated API routes ─────────────────────────────────────────────────
  const auth = requireUser(db);
  const activeSub = requireActiveSubscription();

  // TOTP management — requires an active session.
  app.use('/api/auth/totp', auth, totpRouter(db));

  // Billing: no subscription gate on billing itself (users need to check status
  // and manage their subscription even when expired).
  app.use('/api/billing',       auth, billingRouter());

  // Dev-only override (DEV_TOOLS=1); empty router when disabled.
  app.use('/api/dev',           auth, devBillingRouter());

  app.use('/api/accounts',      auth, activeSub, accountsRouter());
  app.use('/api/categories',    auth, categoriesRouter());
  app.use('/api/rules',         auth, activeSub, rulesRouter());
  app.use('/api/transactions',  auth, transactionsRouter());
  app.use('/api/imports',       auth, activeSub, importsRouter());
  app.use('/api/receipts',      auth, receiptsRouter(driveService));
  app.use('/api/reports',       auth, reportsRouter());
  app.use('/api/exports',       auth, exportsRouter());
  app.use('/api/startup-check', auth, startupRouter());

  // ── Static SPA ───────────────────────────────────────────────────────────────
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Web app not built yet. Run: npm run build -w web');
    });
  });

  // ── Error handler ────────────────────────────────────────────────────────────
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
