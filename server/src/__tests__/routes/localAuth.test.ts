/**
 * Integration tests for the local-auth register route, focused on input
 * validation. The happy path requires passport's req.login() to be wired,
 * which is out of scope here — provisionDefaults with an explicit business
 * name is covered separately in __tests__/repos/users.test.ts.
 */
import express, { Application } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { localAuthRouter } from '../../routes/localAuth';

function makeApp(h: TestDb): Application {
  const app = express();
  app.use(express.json());
  app.use('/auth/local', localAuthRouter(h.db));
  return app;
}

describe('POST /auth/local/register — validation', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeApp(h);
  });
  afterEach(() => h.close());

  it('rejects a request without a business name', async () => {
    const res = await request(app).post('/auth/local/register').send({
      username: 'newuser',
      password: 'abcd1234',
      email: 'new@example.com',
      acceptTos: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/business name/i);
  });

  it('rejects a blank business name', async () => {
    const res = await request(app).post('/auth/local/register').send({
      username: 'newuser',
      password: 'abcd1234',
      email: 'new@example.com',
      businessName: '   ',
      acceptTos: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/business name/i);
  });

  it("rejects 'Personal' as a business name (case-insensitive)", async () => {
    for (const name of ['Personal', 'personal', '  PERSONAL  ']) {
      const res = await request(app).post('/auth/local/register').send({
        username: 'newuser',
        password: 'abcd1234',
        email: 'new@example.com',
        businessName: name,
        acceptTos: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Personal/);
    }
  });

  it('rejects a business name longer than 100 characters', async () => {
    const res = await request(app).post('/auth/local/register').send({
      username: 'newuser',
      password: 'abcd1234',
      email: 'new@example.com',
      businessName: 'a'.repeat(101),
      acceptTos: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100 characters/i);
  });
});
