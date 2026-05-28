import { makeTestDb, TestDb } from '../helpers/db';
import { AiAssistService } from '../../services/aiAssistService';
import { buildContext } from '../../auth/context';

// Mock the LLM client so tests never make real API calls
jest.mock('../../llm/client', () => ({
  isLlmConfigured: jest.fn(() => true),
  chatJson: jest.fn(),
}));

import { chatJson, isLlmConfigured } from '../../llm/client';
const mockChatJson = chatJson as jest.MockedFunction<typeof chatJson>;
const mockIsLlmConfigured = isLlmConfigured as jest.MockedFunction<typeof isLlmConfigured>;

describe('AiAssistService', () => {
  let h: TestDb;
  let service: AiAssistService;

  beforeEach(async () => {
    h = await makeTestDb();
    mockIsLlmConfigured.mockReturnValue(true);
    mockChatJson.mockReset();
    service = new AiAssistService({
      transactions: h.owner.transactions,
      categories: h.owner.categories,
      rules: h.owner.rules,
      accounts: h.owner.accounts,
    });
  });

  afterEach(() => h.close());

  // ── Availability ─────────────────────────────────────────────────────────

  it('isAvailable() returns true when LLM is configured', () => {
    mockIsLlmConfigured.mockReturnValue(true);
    expect(service.isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when LLM is not configured', () => {
    mockIsLlmConfigured.mockReturnValue(false);
    expect(service.isAvailable()).toBe(false);
  });

  // ── suggest() basic flow ─────────────────────────────────────────────────

  it('throws when transaction is not found', async () => {
    await expect(service.suggest(999999)).rejects.toThrow('Transaction not found');
  });

  it('returns valid suggestion when LLM responds with known categoryId', async () => {
    const account = await h.owner.accounts.create({ name: 'Checking', bankType: 'mt', accountKind: 'checking' });
    const category = await h.owner.categories.create({ name: 'Groceries', kind: 'expense', taxExportCode: null });
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
      description: 'WHOLE FOODS',
      amount: -42.50,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-groceries-1',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: category.id,
      confidence: 0.95,
      taxDescription: null,
      rationale: 'Whole Foods is a grocery store.',
      proposedRule: null,
    });

    const result = await service.suggest(tx.id);

    expect(result.categoryId).toBe(category.id);
    expect(result.categoryName).toBe('Groceries');
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.proposedRule).toBeNull();
  });

  // ── validate(): hallucinated categoryId ─────────────────────────────────

  it('returns null categoryId when LLM returns a categoryId not in user\'s list', async () => {
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
      date: '2026-01-15',
      description: 'RANDOM STORE',
      amount: -20.0,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-random-1',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    // LLM hallucinates a categoryId that doesn't exist in the user's categories
    mockChatJson.mockResolvedValue({
      categoryId: 99999,
      confidence: 0.8,
      taxDescription: null,
      rationale: 'Looked it up.',
      proposedRule: null,
    });

    const result = await service.suggest(tx.id);
    expect(result.categoryId).toBeNull();
    expect(result.categoryName).toBeNull();
  });

  // ── validate(): proposedRule confidence threshold ─────────────────────────

  it('strips proposedRule when confidence < 0.5', async () => {
    const account = await h.owner.accounts.create({ name: 'Checking', bankType: 'mt', accountKind: 'checking' });
    const category = await h.owner.categories.create({ name: 'Entertainment', kind: 'expense', taxExportCode: null });
    const stmt = await h.owner.statements.create({
      accountId: account.id,
      period: '2026-01',
      sourcePdfPath: '/tmp/test.pdf',
      parserUsed: 'template',
    });
    await h.owner.transactions.bulkCreate([{
      accountId: account.id,
      statementId: stmt.id,
      date: '2026-01-20',
      description: 'NETFLIX',
      amount: -15.99,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-netflix-1',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: category.id,
      confidence: 0.4, // below 0.5 threshold
      taxDescription: null,
      rationale: 'Maybe entertainment.',
      proposedRule: {
        name: 'Netflix',
        descriptionPattern: 'NETFLIX',
        patternKind: 'substring',
        categoryId: category.id,
        taxDescription: null,
      },
    });

    const result = await service.suggest(tx.id);
    expect(result.proposedRule).toBeNull();
  });

  it('includes proposedRule when confidence >= 0.5', async () => {
    const account = await h.owner.accounts.create({ name: 'Checking', bankType: 'mt', accountKind: 'checking' });
    const category = await h.owner.categories.create({ name: 'Subscriptions', kind: 'expense', taxExportCode: null });
    const stmt = await h.owner.statements.create({
      accountId: account.id,
      period: '2026-01',
      sourcePdfPath: '/tmp/test.pdf',
      parserUsed: 'template',
    });
    await h.owner.transactions.bulkCreate([{
      accountId: account.id,
      statementId: stmt.id,
      date: '2026-01-20',
      description: 'NETFLIX.COM',
      amount: -15.99,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-netflix-2',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: category.id,
      confidence: 0.85,
      taxDescription: null,
      rationale: 'Recurring Netflix subscription.',
      proposedRule: {
        name: 'Netflix',
        descriptionPattern: 'NETFLIX',
        patternKind: 'substring',
        categoryId: category.id,
        taxDescription: null,
      },
    });

    const result = await service.suggest(tx.id);
    expect(result.proposedRule).not.toBeNull();
    expect(result.proposedRule?.name).toBe('Netflix');
    expect(result.proposedRule?.descriptionPattern).toBe('NETFLIX');
    expect(result.proposedRule?.patternKind).toBe('substring');
  });

  it('strips proposedRule when categoryId is hallucinated (even with high confidence)', async () => {
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
      date: '2026-01-22',
      description: 'STARBUCKS',
      amount: -5.50,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: 'hash-sbux-1',
    } as any]);
    const [tx] = await h.owner.transactions.findAll();

    mockChatJson.mockResolvedValue({
      categoryId: 88888, // hallucinated
      confidence: 0.99,
      taxDescription: null,
      rationale: 'Coffee.',
      proposedRule: {
        name: 'Starbucks',
        descriptionPattern: 'STARBUCKS',
        patternKind: 'substring',
        categoryId: 88888,
        taxDescription: null,
      },
    });

    const result = await service.suggest(tx.id);
    expect(result.categoryId).toBeNull();
    expect(result.proposedRule).toBeNull();
  });
});
