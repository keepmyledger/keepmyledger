import { makeTestDb, TestDb } from '../helpers/db';

describe('SqliteReceiptRepo', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  async function makeAccountAndTx(which: 'owner' | 'alt' = 'owner') {
    const acct = await h[which].accounts.create({
      name: `${which} acct`, bankType: 'mt', accountKind: 'checking',
    });
    const stmt = await h[which].statements.create({
      accountId: acct.id, period: '2026-01', sourcePdfPath: '/x.pdf', parserUsed: 'template',
    });
    const { inserted } = await h[which].transactions.bulkCreate([{
      accountId: acct.id, statementId: stmt.id, date: '2026-01-15',
      description: 'TEST',  amount: -10, categoryId: null, categorySource: null,
      suggestedCategoryId: null, ruleId: null, notes: null,
      taxDescription: null, externalHash: `h-${which}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any]);
    expect(inserted).toBe(1);
    const tx = (await h[which].transactions.findAll())[0];
    return { acct, stmt, tx };
  }

  it('creates, lists, finds by drive id', async () => {
    const r = await h.owner.receipts.create({
      driveFileId: 'drive-1', driveFileName: 'r.pdf', driveMimeType: 'application/pdf',
      driveWebViewLink: 'https://x', driveThumbnailLink: null,
    });
    expect(r.id).toBeGreaterThan(0);
    expect((await h.owner.receipts.findAll()).map((x) => x.id)).toEqual([r.id]);
    expect((await h.owner.receipts.findByDriveFileId('drive-1'))?.id).toBe(r.id);
    expect(await h.owner.receipts.findByDriveFileId('missing')).toBeUndefined();
  });

  it('links and unlinks to transactions', async () => {
    const { tx } = await makeAccountAndTx();
    const r = await h.owner.receipts.create({
      driveFileId: 'd', driveFileName: 'r.pdf', driveMimeType: null,
      driveWebViewLink: null, driveThumbnailLink: null,
    });
    await h.owner.receipts.linkToTransaction(r.id, tx.id);
    expect((await h.owner.receipts.findByTransactionId(tx.id)).map((x) => x.id)).toEqual([r.id]);
    // duplicate link is idempotent
    await h.owner.receipts.linkToTransaction(r.id, tx.id);
    expect((await h.owner.receipts.findByTransactionId(tx.id)).length).toBe(1);

    await h.owner.receipts.unlinkFromTransaction(r.id, tx.id);
    expect(await h.owner.receipts.findByTransactionId(tx.id)).toEqual([]);
  });

  it('isolates receipts between users', async () => {
    const oR = await h.owner.receipts.create({
      driveFileId: 'o', driveFileName: 'o.pdf', driveMimeType: null,
      driveWebViewLink: null, driveThumbnailLink: null,
    });
    const aR = await h.alt.receipts.create({
      driveFileId: 'a', driveFileName: 'a.pdf', driveMimeType: null,
      driveWebViewLink: null, driveThumbnailLink: null,
    });
    expect((await h.owner.receipts.findAll()).map((r) => r.id)).toEqual([oR.id]);
    expect((await h.alt.receipts.findAll()).map((r) => r.id)).toEqual([aR.id]);
    expect(await h.owner.receipts.findById(aR.id)).toBeUndefined();
    expect(await h.owner.receipts.deleteReceipt(aR.id)).toBe(false);
    expect(await h.alt.receipts.findById(aR.id)).toBeDefined();
  });

  it('findByDriveFileId is scoped per user (other user cannot read by drive id)', async () => {
    await h.owner.receipts.create({
      driveFileId: 'owned-by-owner', driveFileName: 'o.pdf', driveMimeType: null,
      driveWebViewLink: null, driveThumbnailLink: null,
    });
    expect(await h.alt.receipts.findByDriveFileId('owned-by-owner')).toBeUndefined();
  });
});
