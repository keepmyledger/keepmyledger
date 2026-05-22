import { makeTestDb, TestDb } from '../helpers/db';

describe('SqliteAccountRepo', () => {
  let h: TestDb;

  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('creates, reads, updates, and deletes accounts', async () => {
    const created = await h.owner.accounts.create({
      name: 'Checking',
      bankType: 'mt',
      accountKind: 'checking',
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe('Checking');
    expect(created.lastStatementPeriod).toBeNull();

    const fetched = await h.owner.accounts.findById(created.id);
    expect(fetched).toEqual(created);

    const updated = await h.owner.accounts.update(created.id, { name: 'Checking 2' });
    expect(updated?.name).toBe('Checking 2');

    await h.owner.accounts.updateLastStatementPeriod(created.id, '2026-01');
    expect((await h.owner.accounts.findById(created.id))?.lastStatementPeriod).toBe('2026-01');

    expect(await h.owner.accounts.delete(created.id)).toBe(true);
    expect(await h.owner.accounts.findById(created.id)).toBeUndefined();
  });

  it('isolates accounts between users', async () => {
    const a = await h.owner.accounts.create({ name: 'Owner-acct', bankType: 'mt', accountKind: 'checking' });
    const b = await h.alt.accounts.create({ name: 'Alt-acct', bankType: 'chase', accountKind: 'credit_card' });

    expect((await h.owner.accounts.findAll()).map((x) => x.name)).toEqual(['Owner-acct']);
    expect((await h.alt.accounts.findAll()).map((x) => x.name)).toEqual(['Alt-acct']);

    // Owner cannot read alt's account by id
    expect(await h.owner.accounts.findById(b.id)).toBeUndefined();
    // Owner cannot delete alt's account
    expect(await h.owner.accounts.delete(b.id)).toBe(false);
    // ...and alt's account still exists
    expect(await h.alt.accounts.findById(b.id)).toBeDefined();

    // Owner cannot update alt's account
    const sneaky = await h.owner.accounts.update(b.id, { name: 'pwned' });
    expect(sneaky).toBeUndefined();
    expect((await h.alt.accounts.findById(b.id))?.name).toBe('Alt-acct');

    // Owner.updateLastStatementPeriod on alt's id is a no-op
    await h.owner.accounts.updateLastStatementPeriod(b.id, '1999-12');
    expect((await h.alt.accounts.findById(b.id))?.lastStatementPeriod).toBeNull();

    // Sanity: owner's account is still there
    expect(await h.owner.accounts.findById(a.id)).toBeDefined();
  });
});
