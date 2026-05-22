import { makeTestDb, TestDb } from '../helpers/db';

describe('SqliteRuleRepo', () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await makeTestDb();
    // Migrations 003/005 seed transfer/cashback rules under the owner; clear
    // so ordering / isolation assertions are deterministic.
    h.db.exec('DELETE FROM rules');
  });
  afterEach(() => h.close());

  async function someCategoryId(): Promise<number> {
    return (await h.owner.categories.findAll())[0].id;
  }

  it('orders by priority DESC', async () => {
    const cat = await someCategoryId();
    await h.owner.rules.create({ name: 'low', descriptionPattern: 'x', patternKind: 'substring', categoryId: cat, priority: 1 });
    await h.owner.rules.create({ name: 'high', descriptionPattern: 'y', patternKind: 'substring', categoryId: cat, priority: 10 });
    await h.owner.rules.create({ name: 'mid', descriptionPattern: 'z', patternKind: 'substring', categoryId: cat, priority: 5 });
    const ordered = await h.owner.rules.findOrdered();
    expect(ordered.map((r) => r.name)).toEqual(['high', 'mid', 'low']);
  });

  it('isolates rules between users', async () => {
    const ownerCat = await someCategoryId();
    const altCat = (await h.alt.categories.findAll())[0].id;
    const ownerRule = await h.owner.rules.create({ name: 'o', descriptionPattern: 'foo', patternKind: 'substring', categoryId: ownerCat });
    const altRule = await h.alt.rules.create({ name: 'a', descriptionPattern: 'foo', patternKind: 'substring', categoryId: altCat });

    expect((await h.owner.rules.findAll()).map((r) => r.id)).toEqual([ownerRule.id]);
    expect((await h.alt.rules.findAll()).map((r) => r.id)).toEqual([altRule.id]);

    expect(await h.owner.rules.findById(altRule.id)).toBeUndefined();
    expect(await h.owner.rules.delete(altRule.id)).toBe(false);
    expect(await h.owner.rules.update(altRule.id, { name: 'pwned' })).toBeUndefined();
    expect(await h.alt.rules.findById(altRule.id)).toBeDefined();
  });
});
