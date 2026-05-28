import { makeTestDb, TestDb } from '../helpers/db';
import { OWNER_USER_ID } from '../../repos/impl';

describe('SqliteUserRepo', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('getOwner returns the seeded singleton', async () => {
    const owner = await h.userRepo.getOwner();
    expect(owner.id).toBe(OWNER_USER_ID);
  });

  it('upsertIdentity is idempotent on (provider, providerUserId)', async () => {
    const u = await h.userRepo.create({ email: 'a@b.c', name: 'A' });
    await h.userRepo.upsertIdentity({ userId: u.id, provider: 'google', providerUserId: 'g-1', email: 'a@b.c' });
    await h.userRepo.upsertIdentity({ userId: u.id, provider: 'google', providerUserId: 'g-1', email: 'changed@b.c' });
    const found = await h.userRepo.findByIdentity('google', 'g-1');
    expect(found?.id).toBe(u.id);
  });

  it('provisionDefaults is idempotent', async () => {
    const u = await h.userRepo.create({ email: 'd@e.f', name: 'D' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(u.id);
    const repos1 = (await import('../../repos/impl')).createRepos(h.db, u.id, orgId, businessId);
    const cats1 = await repos1.categories.findAll();
    const rules1 = await repos1.rules.findAll();
    await h.userRepo.provisionDefaults(u.id);
    const cats2 = await repos1.categories.findAll();
    const rules2 = await repos1.rules.findAll();
    expect(cats2.length).toBe(cats1.length);
    expect(rules2.length).toBe(rules1.length);
  });

  it('provisionDefaults uses an explicit businessName when supplied', async () => {
    const u = await h.userRepo.create({ email: 'biz@e.f', name: 'B' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(u.id, 'Acme LLC');
    const repos = (await import('../../repos/impl')).createRepos(h.db, u.id, orgId, businessId);
    const biz = await repos.businesses.findById(businessId);
    expect(biz?.name).toBe('Acme LLC');
    // Org name is auto-derived from business name so the UI doesn't show "Personal".
    const orgRow = await h.db.get<{ name: string }>('SELECT name FROM organizations WHERE id = ?', [orgId]);
    expect(orgRow?.name).toBe('Acme LLC');
  });

  it('provisionDefaults falls back to "Personal" when no businessName is supplied', async () => {
    const u = await h.userRepo.create({ email: 'oauth@e.f', name: 'O' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(u.id);
    const repos = (await import('../../repos/impl')).createRepos(h.db, u.id, orgId, businessId);
    const biz = await repos.businesses.findById(businessId);
    expect(biz?.name).toBe('Personal');
  });

  it('provisionDefaults seeds auto-rules pointing at the user\'s own categories', async () => {
    const u = await h.userRepo.create({ email: 'r@e.f', name: 'R' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(u.id);
    const repos = (await import('../../repos/impl')).createRepos(h.db, u.id, orgId, businessId);
    const rules = await repos.rules.findAll();
    const cats = await repos.categories.findAll();
    const catById = new Map(cats.map((c) => [c.id, c]));

    // At least the auto-rules we seed in UserRepoImpl
    expect(rules.length).toBeGreaterThanOrEqual(9);
    const chasePayment = rules.find((r) => r.name === 'Auto: Chase payment received');
    expect(chasePayment).toBeDefined();
    expect(chasePayment!.descriptionPattern).toBe('Payment Thank You');
    expect(catById.get(chasePayment!.categoryId)?.name).toBe('Credit Card Payment');

    // Every auto-rule category must belong to THIS user (tenant isolation)
    for (const r of rules) {
      expect(catById.has(r.categoryId)).toBe(true);
    }
  });

  it('receiptStoragePreference defaults to null and round-trips through set+findById', async () => {
    const u = await h.userRepo.create({ email: 's@t.u', name: 'S' });
    expect(u.receiptStoragePreference).toBeNull();

    await h.userRepo.setReceiptStoragePreference(u.id, 'kml');
    expect((await h.userRepo.findById(u.id))?.receiptStoragePreference).toBe('kml');

    await h.userRepo.setReceiptStoragePreference(u.id, 'drive');
    expect((await h.userRepo.findById(u.id))?.receiptStoragePreference).toBe('drive');

    await h.userRepo.setReceiptStoragePreference(u.id, null);
    expect((await h.userRepo.findById(u.id))?.receiptStoragePreference).toBeNull();
  });
});
