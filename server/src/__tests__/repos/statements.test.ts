import { makeTestDb, TestDb } from '../helpers/db';

describe('SqliteStatementRepo', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  async function makeAccount(which: 'owner' | 'alt' = 'owner') {
    return h[which].accounts.create({
      name: `${which} acct`,
      bankType: 'mt',
      accountKind: 'checking',
    });
  }

  it('creates and looks up by account+period (unique)', async () => {
    const acct = await makeAccount();
    const s = await h.owner.statements.create({
      accountId: acct.id,
      period: '2026-01',
      sourcePdfPath: '/tmp/foo.pdf',
      parserUsed: 'template',
    });
    expect(s.id).toBeGreaterThan(0);
    const found = await h.owner.statements.findByAccountAndPeriod(acct.id, '2026-01');
    expect(found?.id).toBe(s.id);
    expect(found?.parserUsed).toBe('template');
  });

  it('isolates statements between users', async () => {
    const ownerAcct = await makeAccount('owner');
    const altAcct = await makeAccount('alt');
    const oS = await h.owner.statements.create({
      accountId: ownerAcct.id, period: '2026-01', sourcePdfPath: '/o.pdf', parserUsed: 'template',
    });
    const aS = await h.alt.statements.create({
      accountId: altAcct.id, period: '2026-01', sourcePdfPath: '/a.pdf', parserUsed: 'llm',
    });

    expect((await h.owner.statements.findAll()).map((s) => s.id)).toEqual([oS.id]);
    expect((await h.alt.statements.findAll()).map((s) => s.id)).toEqual([aS.id]);

    expect(await h.owner.statements.findById(aS.id)).toBeUndefined();
    expect(await h.owner.statements.delete(aS.id)).toBe(false);
    expect(await h.alt.statements.findById(aS.id)).toBeDefined();
  });

  it('findByAccount lists statements sorted by period DESC', async () => {
    const acct = await makeAccount();
    await h.owner.statements.create({ accountId: acct.id, period: '2026-01', sourcePdfPath: '/a.pdf', parserUsed: 'template' });
    await h.owner.statements.create({ accountId: acct.id, period: '2026-03', sourcePdfPath: '/c.pdf', parserUsed: 'template' });
    await h.owner.statements.create({ accountId: acct.id, period: '2026-02', sourcePdfPath: '/b.pdf', parserUsed: 'template' });
    const list = await h.owner.statements.findByAccount(acct.id);
    expect(list.map((s) => s.period)).toEqual(['2026-03', '2026-02', '2026-01']);
  });
});
