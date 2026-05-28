/**
 * Auth route integration tests (issue #33).
 *
 * Tests the /auth/* endpoints using an in-memory SQLite database.
 * Passport strategies are bypassed — req.user is injected directly.
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { authRouter } from '../../routes/auth';
import type { AvailableProvider } from '../../auth/passport';

// passport.authenticate calls would trigger the real passport middleware;
// mock it so route-registration tests don't need real OAuth credentials.
jest.mock('passport', () => ({
  authenticate: jest.fn(
    (_strategy: string, _opts?: object) =>
      (_req: Request, _res: Response, next: NextFunction) =>
        next(),
  ),
}));

function makeApp(
  h: TestDb,
  providers: AvailableProvider[] = [],
  authenticatedUserId?: string,
): Application {
  const app = express();
  app.use(express.json());

  // Simulate session/passport by pre-setting req.user when provided.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (authenticatedUserId) {
      (req as unknown as { user: { id: string } }).user = { id: authenticatedUserId };
    }
    next();
  });

  // Minimal session stub so logout can call req.session.destroy()
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!(req as unknown as Record<string, unknown>).session) {
      (req as unknown as Record<string, unknown>).session = {
        destroy: (cb: () => void) => cb(),
      };
    }
    next();
  });

  // Mock req.logout as used by Passport
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { logout: (cb: (err: unknown) => void) => void }).logout = (cb) => cb(null);
    next();
  });

  app.use('/auth', authRouter(h.db, providers));
  return app;
}

describe('GET /auth/me', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('returns { user: null } when not authenticated', async () => {
    const app = makeApp(h);
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('returns the user object when authenticated', async () => {
    const app = makeApp(h, [], h.ownerId);
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).not.toBeNull();
    expect(res.body.user.id).toBe(h.ownerId);
  });

  it('returns { user: null } for an unknown user id', async () => {
    const app = makeApp(h, [], 'nonexistent-user-id');
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

describe('POST /auth/logout', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('returns { ok: true } and destroys session', async () => {
    const app = makeApp(h, [], h.ownerId);
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('OAuth provider registration', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('GET /auth/google returns 404 when google provider is NOT registered', async () => {
    const app = makeApp(h, []); // no providers
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(404);
  });

  it('calls passport.authenticate for google when google provider IS registered', () => {
    // passport.authenticate is called at route-registration time.
    // Check it was invoked with 'google' when the provider is enabled.
    const { authenticate } = jest.requireMock('passport') as { authenticate: jest.Mock };
    authenticate.mockClear();

    const providers: AvailableProvider[] = [{ id: 'google', label: 'Google' }];
    makeApp(h, providers);

    const calledWithGoogle = authenticate.mock.calls.some((args) => args[0] === 'google');
    expect(calledWithGoogle).toBe(true);
  });

  it('does NOT call passport.authenticate for google when provider is absent', () => {
    const { authenticate } = jest.requireMock('passport') as { authenticate: jest.Mock };
    authenticate.mockClear();

    makeApp(h, []); // no providers

    const calledWithGoogle = authenticate.mock.calls.some((args) => args[0] === 'google');
    expect(calledWithGoogle).toBe(false);
  });

  it('GET /auth/google/callback redirects to / on success', async () => {
    const providers: AvailableProvider[] = [{ id: 'google', label: 'Google' }];
    const app = makeApp(h, providers);
    const res = await request(app).get('/auth/google/callback');
    // passport.authenticate mock calls next(); route handler then redirects to /
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
