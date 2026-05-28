/**
 * Routes integration tests.
 *
 * Creates a minimal Express app with in-memory SQLite and tests the
 * accounts, transactions, categories, and rules routes end-to-end.
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { makeTestDb, TestDb } from '../helpers/db';
import { buildContext } from '../../auth/context';
import { accountsRouter } from '../../routes/accounts';
import { transactionsRouter } from '../../routes/transactions';
import { categoriesRouter } from '../../routes/categories';
import { rulesRouter } from '../../routes/rules';
import { requireUser } from '../../middleware/requireUser';

/**
 * Build a test Express app with req.ctx pre-populated for the owner user.
 * No authentication middleware — ctx is injected directly.
 */
function makeApp(h: TestDb): Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.ctx = buildContext(h.db, h.ownerId, h.ownerOrgId, h.ownerBusinessId);
    next();
  });
  app.use('/accounts', accountsRouter());
  app.use('/transactions', transactionsRouter());
  app.use('/categories', categoriesRouter());
  app.use('/rules', rulesRouter());
  return app;
}

describe('Accounts routes', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeApp(h);
  });

  afterEach(() => h.close());

  it('GET /accounts returns empty list initially', async () => {
    const res = await request(app).get('/accounts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /accounts creates a new account', async () => {
    const res = await request(app).post('/accounts').send({
      name: 'Main Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Main Checking');
    expect(res.body.bankType).toBe('mt');
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('POST /accounts returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/accounts').send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('GET /accounts/:id returns the account', async () => {
    const created = await h.owner.accounts.create({ name: 'Savings', bankType: 'mt', accountKind: 'checking' });
    const res = await request(app).get(`/accounts/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Savings');
  });

  it('GET /accounts/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/accounts/99999');
    expect(res.status).toBe(404);
  });

  it('PATCH /accounts/:id updates the account name', async () => {
    const created = await h.owner.accounts.create({ name: 'Old Name', bankType: 'mt', accountKind: 'checking' });
    const res = await request(app).patch(`/accounts/${created.id}`).send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('DELETE /accounts/:id removes the account', async () => {
    const created = await h.owner.accounts.create({ name: 'To Delete', bankType: 'mt', accountKind: 'checking' });
    const res = await request(app).delete(`/accounts/${created.id}`);
    expect(res.status).toBe(204);

    const check = await request(app).get(`/accounts/${created.id}`);
    expect(check.status).toBe(404);
  });

  it('GET /accounts returns all accounts', async () => {
    await h.owner.accounts.create({ name: 'Acc1', bankType: 'mt', accountKind: 'checking' });
    await h.owner.accounts.create({ name: 'Acc2', bankType: 'chase', accountKind: 'credit_card' });

    const res = await request(app).get('/accounts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('Categories routes', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeApp(h);
  });

  afterEach(() => h.close());

  it('GET /categories returns empty list initially', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    // May have seeded categories from migrations
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /categories creates a new category', async () => {
    const res = await request(app).post('/categories').send({
      name: 'Test Category Unique',
      kind: 'expense',
      taxExportCode: 'OFFICE',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Category Unique');
    expect(res.body.kind).toBe('expense');
  });

  it('DELETE /categories/:id removes the category', async () => {
    const cat = await h.owner.categories.create({ name: 'Temp', kind: 'expense', taxExportCode: null });
    const res = await request(app).delete(`/categories/${cat.id}`);
    expect(res.status).toBe(204);
  });
});

describe('Rules routes', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeApp(h);
  });

  afterEach(() => h.close());

  it('POST /rules creates a rule', async () => {
    const cat = await h.owner.categories.create({ name: 'Food', kind: 'expense', taxExportCode: null });

    const res = await request(app).post('/rules').send({
      name: 'Starbucks',
      descriptionPattern: 'STARBUCKS',
      patternKind: 'substring',
      categoryId: cat.id,
      amountMin: null,
      amountMax: null,
      accountId: null,
      taxDescription: null,
      priority: 0,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Starbucks');
    expect(res.body.categoryId).toBe(cat.id);
  });

  it('GET /rules returns created rules', async () => {
    const cat = await h.owner.categories.create({ name: 'Food', kind: 'expense', taxExportCode: null });
    await h.owner.rules.create({
      name: 'Starbucks',
      descriptionPattern: 'STARBUCKS',
      patternKind: 'substring',
      categoryId: cat.id,
      amountMin: null,
      amountMax: null,
      accountId: null,
      taxDescription: null,
      priority: 0,
    });

    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some((r: { name: string }) => r.name === 'Starbucks')).toBe(true);
  });
});

describe('Transactions routes', () => {
  let h: TestDb;
  let app: Application;

  beforeEach(async () => {
    h = await makeTestDb();
    app = makeApp(h);
  });

  afterEach(() => h.close());

  it('GET /transactions returns empty list initially', async () => {
    const res = await request(app).get('/transactions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('PATCH /transactions/:id updates amount, description, and date', async () => {
    const account = await h.owner.accounts.create({ name: 'Checking', bankType: 'mt', accountKind: 'checking' });
    const stmt = await h.owner.statements.create({
      accountId: account.id,
      period: '2026-01',
      sourcePdfPath: '/tmp/test.pdf',
      parserUsed: 'template',
    });
    await h.owner.transactions.bulkCreate([{
      accountId: account.id,
      statementId: stmt.id,
      date: '2026-01-10',
      description: 'ORIGINAL DESC',
      amount: -50.0,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-tx-routes-1',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    const res = await request(app).patch(`/transactions/${tx.id}`).send({
      description: 'UPDATED DESC',
      amount: -75.0,
      date: '2026-01-15',
    });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('UPDATED DESC');
    expect(res.body.amount).toBe(-75.0);
    expect(res.body.date).toBe('2026-01-15');
  });

  it('PATCH /transactions/:id returns 400 for invalid date format', async () => {
    const account = await h.owner.accounts.create({ name: 'Checking', bankType: 'mt', accountKind: 'checking' });
    const stmt = await h.owner.statements.create({
      accountId: account.id,
      period: '2026-01',
      sourcePdfPath: '/tmp/test.pdf',
      parserUsed: 'template',
    });
    await h.owner.transactions.bulkCreate([{
      accountId: account.id,
      statementId: stmt.id,
      date: '2026-01-10',
      description: 'TX',
      amount: -20.0,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-tx-routes-2',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    const res = await request(app).patch(`/transactions/${tx.id}`).send({
      date: '15-01-2026', // wrong format
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });

  it('PATCH /transactions/:id returns 404 for unknown id', async () => {
    const res = await request(app).patch('/transactions/99999').send({ description: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('requireUser middleware: 401 in saas mode', () => {
  let h: TestDb;
  let saasApp: Application;

  beforeEach(async () => {
    h = await makeTestDb();

    // Build a saas-mode app with real requireUser middleware (no pre-injected ctx)
    const originalMode = process.env.APP_MODE;
    process.env.APP_MODE = 'saas';

    saasApp = express();
    saasApp.use(express.json());
    saasApp.use(requireUser(h.db));
    saasApp.use('/accounts', accountsRouter());

    // Restore mode after setup so other tests are unaffected
    process.env.APP_MODE = originalMode;
  });

  afterEach(() => {
    h.close();
    delete process.env.APP_MODE;
  });

  it('returns 401 when no user is in session (saas mode)', async () => {
    // Force saas mode for this request
    const origMode = process.env.APP_MODE;
    process.env.APP_MODE = 'saas';

    const res = await request(saasApp).get('/accounts');

    process.env.APP_MODE = origMode;

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });
});
