import { makeTestDb, TestDb } from '../helpers/db';
import { ImportService } from '../../services/importService';
import { CategorizationService } from '../../services/categorizationService';
import { ParsedStatement } from '../../parsers/types';

function makeImportService(h: TestDb): ImportService {
  const { accounts, statements, transactions, rules, categories } = h.owner;
  const categorization = new CategorizationService(rules, transactions, categories);
  return new ImportService(accounts, statements, transactions, categorization);
}

function makeStatement(overrides?: Partial<ParsedStatement>): ParsedStatement {
  return {
    period: '2026-01',
    bankType: 'mt',
    parserUsed: 'template',
    transactions: [
      { date: '2026-01-05', description: 'GROCERY STORE', amount: 50.0 },
      { date: '2026-01-10', description: 'GAS STATION', amount: 40.0 },
      { date: '2026-01-20', description: 'PAYROLL DEPOSIT', amount: -1000.0 },
    ],
    ...overrides,
  };
}

describe('ImportService.persistParsed', () => {
  let h: TestDb;
  let service: ImportService;

  beforeEach(async () => {
    h = await makeTestDb();
    service = makeImportService(h);
  });

  afterEach(() => h.close());

  it('inserts all transactions from a parsed statement', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    const result = await service.persistParsed(account.id, '/tmp/test.pdf', makeStatement());

    expect(result.transactionsImported).toBe(3);
    expect(result.pendingReview).toEqual([]);
    expect(result.period).toBe('2026-01');
    expect(result.parserUsed).toBe('template');
    expect(result.transactions).toHaveLength(3);
  });

  it('flags re-imported rows as pendingReview instead of silently dropping them', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    const stmt = makeStatement();

    const first = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    expect(first.transactionsImported).toBe(3);
    expect(first.pendingReview).toEqual([]);

    const second = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    expect(second.transactionsImported).toBe(0);
    expect(second.pendingReview).toHaveLength(3);
    // Each pendingReview entry has both the parsed row and the existing match.
    for (const p of second.pendingReview) {
      expect(p.existing).toBeDefined();
      expect(p.existing.id).toBeGreaterThan(0);
      expect(p.parsed.date).toBe(p.existing.date);
      expect(p.parsed.amount).toBe(p.existing.amount);
    }
  });

  it('is idempotent: re-importing the same period reuses the statement row', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    const stmt = makeStatement();
    const first = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    const second = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);

    expect(first.statementId).toBe(second.statementId);
  });

  it('flips sign for credit card accounts with template parser', async () => {
    const account = await h.owner.accounts.create({
      name: 'Credit Card',
      bankType: 'chase',
      accountKind: 'credit_card',
    });

    // Template parser: charges are positive, payments are negative (bank convention)
    const stmt = makeStatement({
      bankType: 'chase',
      parserUsed: 'template',
      transactions: [
        { date: '2026-01-05', description: 'RESTAURANT', amount: 75.0 },   // charge → should become -75
        { date: '2026-01-10', description: 'PAYMENT THANK YOU', amount: -500.0 }, // payment → should become +500
      ],
    });

    const result = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    const txs = result.transactions.sort((a, b) => a.description.localeCompare(b.description));

    const payment = txs.find((t) => t.description === 'PAYMENT THANK YOU');
    const restaurant = txs.find((t) => t.description === 'RESTAURANT');

    expect(restaurant?.amount).toBe(-75.0);
    expect(payment?.amount).toBe(500.0);
  });

  it('does not flip sign for credit card with LLM parser (already in storage convention)', async () => {
    const account = await h.owner.accounts.create({
      name: 'Credit Card',
      bankType: 'chase',
      accountKind: 'credit_card',
    });

    const stmt = makeStatement({
      bankType: 'chase',
      parserUsed: 'llm',
      transactions: [
        { date: '2026-01-05', description: 'RESTAURANT', amount: -75.0 },
        { date: '2026-01-10', description: 'PAYMENT', amount: 500.0 },
      ],
    });

    const result = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    const txs = result.transactions;
    const restaurant = txs.find((t) => t.description === 'RESTAURANT');
    const payment = txs.find((t) => t.description === 'PAYMENT');

    expect(restaurant?.amount).toBe(-75.0);
    expect(payment?.amount).toBe(500.0);
  });

  it('updates account.lastStatementPeriod when period is newer', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    await service.persistParsed(account.id, '/tmp/jan.pdf', makeStatement({ period: '2026-01' }));
    const afterJan = await h.owner.accounts.findById(account.id);
    expect(afterJan?.lastStatementPeriod).toBe('2026-01');

    await service.persistParsed(
      account.id,
      '/tmp/feb.pdf',
      makeStatement({ period: '2026-02', transactions: [{ date: '2026-02-05', description: 'STORE', amount: 20.0 }] })
    );
    const afterFeb = await h.owner.accounts.findById(account.id);
    expect(afterFeb?.lastStatementPeriod).toBe('2026-02');
  });

  it('does not downgrade account.lastStatementPeriod when period is older', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    await service.persistParsed(
      account.id,
      '/tmp/feb.pdf',
      makeStatement({ period: '2026-02', transactions: [{ date: '2026-02-05', description: 'STORE', amount: 20.0 }] })
    );
    await service.persistParsed(account.id, '/tmp/jan.pdf', makeStatement({ period: '2026-01' }));

    const account2 = await h.owner.accounts.findById(account.id);
    expect(account2?.lastStatementPeriod).toBe('2026-02');
  });

  it('throws when accountId does not exist', async () => {
    await expect(
      service.persistParsed(99999, '/tmp/test.pdf', makeStatement())
    ).rejects.toThrow('Account 99999 not found');
  });

  it('only inserts new transactions on partial re-import', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    const base = makeStatement({
      transactions: [
        { date: '2026-01-05', description: 'GROCERY STORE', amount: 50.0 },
      ],
    });
    await service.persistParsed(account.id, '/tmp/test.pdf', base);

    const extended = makeStatement({
      transactions: [
        { date: '2026-01-05', description: 'GROCERY STORE', amount: 50.0 }, // duplicate
        { date: '2026-01-15', description: 'PHARMACY', amount: 30.0 },       // new
      ],
    });
    const result = await service.persistParsed(account.id, '/tmp/test2.pdf', extended);

    expect(result.transactionsImported).toBe(1);
    expect(result.pendingReview).toHaveLength(1);
    expect(result.pendingReview[0].parsed.description).toBe('GROCERY STORE');
  });

  it('inserts both rows when a same-file batch contains an in-file duplicate', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    // Two identical $5 coffees on the same day — both should land.
    const stmt = makeStatement({
      transactions: [
        { date: '2026-01-05', description: 'STARBUCKS', amount: -5.0 },
        { date: '2026-01-05', description: 'STARBUCKS', amount: -5.0 },
      ],
    });
    const result = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    expect(result.transactionsImported).toBe(2);
    expect(result.pendingReview).toEqual([]);
  });
});

describe('ImportService.resolveDuplicates', () => {
  let h: TestDb;
  let service: ImportService;

  beforeEach(async () => {
    h = await makeTestDb();
    service = makeImportService(h);
  });

  afterEach(() => h.close());

  it('keep action inserts the row; skip action drops it', async () => {
    const account = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });

    // Seed the ledger so the second import produces pendingReview.
    const stmt = makeStatement();
    await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    const second = await service.persistParsed(account.id, '/tmp/test.pdf', stmt);
    expect(second.pendingReview).toHaveLength(3);

    // Keep the first, skip the rest.
    const decisions = second.pendingReview.map((p, idx) => ({
      externalHash: p.externalHash,
      action: idx === 0 ? ('keep' as const) : ('skip' as const),
      date: p.parsed.date,
      description: p.parsed.description,
      amount: p.parsed.amount,
    }));
    const result = await service.resolveDuplicates(second.statementId, decisions);
    expect(result.inserted).toBe(1);

    // The kept row should now appear twice in the DB (original + the re-imported copy);
    // the two skipped rows still appear only once.
    const kept = second.pendingReview[0];
    const all = await h.owner.transactions.findAll({ accountId: account.id });
    const keptMatches = all.filter((t) => t.date === kept.parsed.date && t.amount === kept.parsed.amount);
    expect(keptMatches).toHaveLength(2);
    for (const skipped of second.pendingReview.slice(1)) {
      const skippedMatches = all.filter((t) => t.date === skipped.parsed.date && t.amount === skipped.parsed.amount);
      expect(skippedMatches).toHaveLength(1);
    }
  });
});
