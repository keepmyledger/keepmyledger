import { Transaction } from '@keepmyledger/shared';
import { CategorizationService } from '../../services/categorizationService';
import { makeTestDb, TestDb } from '../helpers/db';
import { hashTransaction } from '../../parsers/utils';

describe('CategorizationService', () => {
  let h: TestDb;
  let svc: CategorizationService;
  let acctId: number;
  let stmtId: number;
  let mealsCatId: number;
  let officeCatId: number;
  let softwareCatId: number;

  async function insertTx(description: string, amount: number, dateOverride?: string): Promise<Transaction> {
    const date = dateOverride ?? '2026-01-15';
    await h.owner.transactions.bulkCreate([{
      accountId: acctId, statementId: stmtId, date, description, amount,
      categoryId: null, categorySource: null, suggestedCategoryId: null, ruleId: null,
      notes: null, taxDescription: null,
      externalHash: hashTransaction(acctId, date, description, amount),
    } as never]);
    return (await h.owner.transactions.findByHash(hashTransaction(acctId, date, description, amount)))!;
  }

  beforeEach(async () => {
    h = await makeTestDb();
    svc = new CategorizationService(h.owner.rules, h.owner.transactions, h.owner.categories);
    acctId = (await h.owner.accounts.create({ name: 'C', bankType: 'amex', accountKind: 'credit_card' })).id;
    stmtId = (await h.owner.statements.create({ accountId: acctId, period: '2026-01', sourcePdfPath: '/x', parserUsed: 'template' })).id;
    mealsCatId = (await h.owner.categories.findByName('Meals & Entertainment'))!.id;
    officeCatId = (await h.owner.categories.findByName('Office Supplies'))!.id;
    softwareCatId = (await h.owner.categories.findByName('Software'))!.id;
  });
  afterEach(() => h.close());

  it('applies highest-priority matching rule', async () => {
    await h.owner.rules.create({ name: 'low', descriptionPattern: 'STARBUCKS', patternKind: 'substring', categoryId: officeCatId, priority: 1 });
    await h.owner.rules.create({ name: 'hi',  descriptionPattern: 'STARBUCKS', patternKind: 'substring', categoryId: mealsCatId,  priority: 10 });
    const tx = await insertTx('STARBUCKS #123', -5);
    await svc.categorize(tx);
    const after = await h.owner.transactions.findById(tx.id);
    expect(after?.categoryId).toBe(mealsCatId);
    expect(after?.categorySource).toBe('rule');
    expect(after?.ruleId).not.toBeNull();
  });

  it('never overwrites a manual categorization', async () => {
    await h.owner.rules.create({ name: 'r', descriptionPattern: 'COFFEE', patternKind: 'substring', categoryId: mealsCatId });
    const tx = await insertTx('COFFEE SHOP', -4);
    await h.owner.transactions.update(tx.id, { categoryId: softwareCatId, categorySource: 'manual' });
    const before = await h.owner.transactions.findById(tx.id);
    await svc.categorize(before!);
    const after = await h.owner.transactions.findById(tx.id);
    expect(after?.categoryId).toBe(softwareCatId);
    expect(after?.categorySource).toBe('manual');
  });

  it('respects rule accountId scope and amount range', async () => {
    const otherAcct = await h.owner.accounts.create({ name: 'Other', bankType: 'mt', accountKind: 'checking' });
    // Rule restricted to a DIFFERENT account → should not match
    await h.owner.rules.create({ name: 'scoped', descriptionPattern: 'AMAZON', patternKind: 'substring', categoryId: officeCatId, accountId: otherAcct.id });
    // Rule with amount floor of -10 (only matches charges >= -10, i.e. small); our tx is -50, should NOT match
    await h.owner.rules.create({ name: 'small', descriptionPattern: 'AMAZON', patternKind: 'substring', categoryId: softwareCatId, amountMin: -10 });
    const tx = await insertTx('AMAZON.COM', -50);
    await svc.categorize(tx);
    const after = await h.owner.transactions.findById(tx.id);
    expect(after?.categoryId).toBeNull();
    expect(after?.ruleId).toBeNull();
  });

  it('applies regex rule and preserves existing taxDescription', async () => {
    await h.owner.rules.create({
      name: 'rgx',
      descriptionPattern: '^GITHUB\\b',
      patternKind: 'regex',
      categoryId: softwareCatId,
      taxDescription: 'Dev tooling',
    });
    const tx = await insertTx('GITHUB COPILOT', -10);
    // Pre-existing taxDescription should NOT be overwritten by the rule
    await h.owner.transactions.update(tx.id, { taxDescription: 'Original note' });
    const fresh = await h.owner.transactions.findById(tx.id);
    await svc.categorize(fresh!);
    const after = await h.owner.transactions.findById(tx.id);
    expect(after?.categoryId).toBe(softwareCatId);
    expect(after?.taxDescription).toBe('Original note');
  });

  it('history fallback assigns suggestedCategoryId without setting categoryId', async () => {
    // Seed a manually-categorized historical tx
    const past = await insertTx('UBER TRIP DOWNTOWN', -25, '2025-12-01');
    await h.owner.transactions.update(past.id, { categoryId: mealsCatId, categorySource: 'manual' });

    // New tx with overlapping tokens
    const fresh = await insertTx('UBER TRIP UPTOWN', -30);
    await svc.categorize(fresh);

    const after = await h.owner.transactions.findById(fresh.id);
    expect(after?.categoryId).toBeNull();
    expect(after?.categorySource).toBe('suggested');
    expect(after?.suggestedCategoryId).toBe(mealsCatId);
  });
});
