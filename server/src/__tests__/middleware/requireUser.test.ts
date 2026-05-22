import type { Request, Response, NextFunction } from 'express';
import { requireUser } from '../../middleware/requireUser';
import { makeTestDb, TestDb } from '../helpers/db';
import { OWNER_USER_ID } from '../../repos/impl';

interface Outcome {
  nextCalled: boolean;
  nextErr?: unknown;
  status?: number;
  body?: unknown;
}

async function invoke(h: TestDb, req: Partial<Request>): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    const outcome: Outcome = { nextCalled: false };
    const res = {
      status(code: number) { outcome.status = code; return this; },
      json(body: unknown) { outcome.body = body; resolve(outcome); return this; },
    } as unknown as Response;
    const next: NextFunction = (err?: unknown) => {
      outcome.nextCalled = true;
      outcome.nextErr = err;
      resolve(outcome);
    };
    requireUser(h.db)(req as Request, res, next);
  });
}

describe('requireUser middleware', () => {
  const ORIGINAL = process.env.APP_MODE;
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(async () => {
    await h.close();
    if (ORIGINAL === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = ORIGINAL;
  });

  describe('selfhost mode', () => {
    beforeEach(() => { delete process.env.APP_MODE; });

    it('attaches owner-scoped ctx with no session', async () => {
      const req: Partial<Request> = { header: () => undefined };
      const out = await invoke(h, req);
      expect(out.nextCalled).toBe(true);
      expect(out.nextErr).toBeUndefined();
      expect(out.status).toBeUndefined();
      expect((req as Request).ctx?.userId).toBe(OWNER_USER_ID);
    });
  });

  describe('saas mode', () => {
    beforeEach(() => { process.env.APP_MODE = 'saas'; });

    it('returns 401 with no session and no x-user-id', async () => {
      const out = await invoke(h, { header: () => undefined });
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(401);
    });

    it('returns 401 for unknown x-user-id', async () => {
      const out = await invoke(h, { header: ((n: string) => (n === 'x-user-id' ? 'nope' : undefined)) as Request['header'] });
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(401);
    });

    it('accepts owner via x-user-id and attaches ctx', async () => {
      const req: Partial<Request> = { header: ((n: string) => (n === 'x-user-id' ? OWNER_USER_ID : undefined)) as Request['header'] };
      const out = await invoke(h, req);
      expect(out.nextCalled).toBe(true);
      expect(out.nextErr).toBeUndefined();
      expect((req as Request).ctx?.userId).toBe(OWNER_USER_ID);
    });
  });
});
