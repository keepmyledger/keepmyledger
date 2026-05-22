import { makeTestDb, TestDb } from '../helpers/db';

describe('SqliteCategoryRepo', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('seeds defaults for both owner and alt via provisionDefaults', async () => {
    const ownerCats = await h.owner.categories.findAll();
    const altCats = await h.alt.categories.findAll();
    expect(ownerCats.length).toBeGreaterThan(10);
    expect(altCats.length).toBe(ownerCats.length);
    // Same template names, but separate ids per user
    const ownerByName = new Map(ownerCats.map((c) => [c.name, c.id]));
    const altByName = new Map(altCats.map((c) => [c.name, c.id]));
    for (const name of ownerByName.keys()) {
      expect(altByName.has(name)).toBe(true);
      expect(altByName.get(name)).not.toBe(ownerByName.get(name));
    }
  });

  it('creates, finds by name, updates, deletes', async () => {
    const created = await h.owner.categories.create({ name: 'Test Cat', kind: 'expense', taxExportCode: 'TC' });
    expect(await h.owner.categories.findByName('Test Cat')).toEqual(created);
    const updated = await h.owner.categories.update(created.id, { taxExportCode: 'TC2' });
    expect(updated?.taxExportCode).toBe('TC2');
    expect(await h.owner.categories.delete(created.id)).toBe(true);
    expect(await h.owner.categories.findById(created.id)).toBeUndefined();
  });

  it('isolates categories between users', async () => {
    const alt = await h.alt.categories.findAll();
    const altId = alt[0].id;
    // Owner cannot see or mutate alt's category row
    expect(await h.owner.categories.findById(altId)).toBeUndefined();
    expect(await h.owner.categories.delete(altId)).toBe(false);
    expect(await h.owner.categories.update(altId, { name: 'pwned' })).toBeUndefined();
    expect(await h.alt.categories.findById(altId)).toBeDefined();
  });
});
