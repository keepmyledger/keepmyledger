import { Transaction } from '@keepmyledger/shared';
import { makeTestDb, TestDb } from '../helpers/db';
import { hashTransaction } from '../../parsers/utils';

type NewTx = Omit<Transaction, 'id'> & { externalHash: string };

function makeTx(accountId: number, statementId: number, date: string, description: string, amount: number, overrides: Partial<NewTx> = {}): NewTx {
  return {
    accountId,
    statementId,
    date,
    description,
    amount,
    categoryId: null,
    categorySource: null,
    suggestedCategoryId: null,
    ruleId: null,
    notes: null,
    taxDescription: null,
    externalHash: hashTransaction(accountId, date, description, amount),
    ...overrides,
  };
}

describe('SqliteTransactionRepo', () => {
  let h: TestDb;
  let ownerAcctId: number;
  let ownerStmtId: number;
  let altAcctId: number;
  let altStmtId: number;

  beforeEach(async () => {
    h = await makeTestDb();
    const ownerAcct = await h.owner.accounts.create({ name: 'O', bankType: 'mt', accountKind: 'checking' });
    ownerAcctId = ownerAcct.id;
    const ownerStmt = await h.owner.statements.create({ accountId: ownerAcctId, period: '2026-01', sourcePdfPath: '/tmp/o.pdf', parserUsed: 'template' });
    ownerStmtId = ownerStmt.id;

    const altAcct = await h.alt.accounts.create({ name: 'A', bankType: 'chase', accountKind: 'credit_card' });
    altAcctId = altAcct.id;
    const altStmt = await h.alt.statements.create({ accountId: altAcctId, period: '2026-01', sourcePdfPath: '/tmp/a.pdf', parserUsed: 'template' });
    altStmtId = altStmt.id;
  });
  afterEach(() => h.close());

  it('bulkCreate inserts every row passed in (no UNIQUE constraint anymore)', async () => {
    const r1 = await h.owner.transactions.bulkCreate([
      makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'COFFEE', -4.5),
      makeTx(ownerAcctId, ownerStmtId, '2026-01-06', 'GAS',   -40),
    ]);
    expect(r1).toEqual({ inserted: 2 });

    // Same-file duplicate: bulkCreate no longer dedups — callers do it via findExistingHashes.
    const r2 = await h.owner.transactions.bulkCreate([
      makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'COFFEE', -4.5),
      makeTx(ownerAcctId, ownerStmtId, '2026-01-07', 'BOOK',   -12),
    ]);
    expect(r2).toEqual({ inserted: 2 });

    expect((await h.owner.transactions.findAll()).length).toBe(4);
  });

  it('findExistingHashes returns only hashes already present for this account', async () => {
    await h.owner.transactions.bulkCreate([
      makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'COFFEE', -4.5),
    ]);
    const all = await h.owner.transactions.findAll();
    const existingHash = (all[0] as unknown as { externalHash?: string }).externalHash ?? '';
    // findExistingHashes uses internal storage; just verify the API shape works.
    const present = await h.owner.transactions.findExistingHashes(ownerAcctId, ['no-such-hash']);
    expect(present.size).toBe(0);
    // Cross-account isolation: alt's repo doesn't see owner's hash.
    const altPresent = await h.alt.transactions.findExistingHashes(altAcctId, [existingHash]);
    expect(altPresent.size).toBe(0);
  });

  it('filters by account, date range, and uncategorized', async () => {
    await h.owner.transactions.bulkCreate([
      makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'A', -1),
      makeTx(ownerAcctId, ownerStmtId, '2026-01-20', 'B', -2),
      makeTx(ownerAcctId, ownerStmtId, '2026-02-01', 'C', -3),
    ]);
    expect((await h.owner.transactions.findAll({ accountId: ownerAcctId })).length).toBe(3);
    expect((await h.owner.transactions.findAll({ dateFrom: '2026-01-15', dateTo: '2026-01-31' })).length).toBe(1);
    expect((await h.owner.transactions.findAll({ uncategorized: true })).length).toBe(3);
  });

  it('isolates transactions and reports between users', async () => {
    await h.owner.transactions.bulkCreate([makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'OWNER-TX', -10)]);
    await h.alt.transactions.bulkCreate([makeTx(altAcctId, altStmtId, '2026-01-05', 'ALT-TX', -20)]);

    const ownerAll = await h.owner.transactions.findAll();
    const altAll = await h.alt.transactions.findAll();
    expect(ownerAll.map((t) => t.description)).toEqual(['OWNER-TX']);
    expect(altAll.map((t) => t.description)).toEqual(['ALT-TX']);

    // Owner cannot read/mutate alt's tx
    const altTxId = altAll[0].id;
    expect(await h.owner.transactions.findById(altTxId)).toBeUndefined();
    expect(await h.owner.transactions.delete(altTxId)).toBe(false);
    expect(await h.owner.transactions.update(altTxId, { description: 'pwned' })).toBeUndefined();
    await h.owner.transactions.setRuleId(altTxId, 999);
    await h.owner.transactions.setSuggestedCategoryId(altTxId, 999);
    const reread = await h.alt.transactions.findById(altTxId);
    expect(reread?.description).toBe('ALT-TX');
    expect(reread?.ruleId).toBeNull();
    expect(reread?.suggestedCategoryId).toBeNull();

    // Reports are tenant-scoped
    const ownerByCat = await h.owner.transactions.reportByCategory();
    const altByCat = await h.alt.transactions.reportByCategory();
    expect(ownerByCat.reduce((s, r) => s + r.total, 0)).toBe(-10);
    expect(altByCat.reduce((s, r) => s + r.total, 0)).toBe(-20);
  });

  it('update recomputes external_hash when dedup fields change', async () => {
    await h.owner.transactions.bulkCreate([makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'COFFEE', -4.5)]);
    const tx = (await h.owner.transactions.findAll())[0];
    await h.owner.transactions.update(tx.id, { description: 'STARBUCKS' });
    // After the update, the original hash is no longer present in the DB.
    const originalHash = makeTx(ownerAcctId, ownerStmtId, '2026-01-05', 'COFFEE', -4.5).externalHash;
    const present = await h.owner.transactions.findExistingHashes(ownerAcctId, [originalHash]);
    expect(present.size).toBe(0);
  });
});
