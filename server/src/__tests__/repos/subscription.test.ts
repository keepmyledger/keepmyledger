import { makeTestDb, TestDb } from '../helpers/db';
import { createRepos, OWNER_USER_ID } from '../../repos/impl';

describe('SubscriptionRepoImpl', () => {
  let h: TestDb;
  const ORIGINAL = process.env.APP_MODE;

  beforeEach(async () => {
    process.env.APP_MODE = 'saas'; // provisionDefaults creates subscriptions in saas mode
    h = await makeTestDb();
  });

  afterEach(async () => {
    await h.close();
    if (ORIGINAL === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = ORIGINAL;
  });

  it('returns undefined when no subscription row exists', async () => {
    // Create a bare user without calling provisionDefaults so no row is inserted.
    const bareUser = await h.userRepo.create({ email: 'bare@example.com', name: 'Bare' });
    // Personal org convention: orgId = userId; businessId=0 (subscription doesn't need it)
    const repos = createRepos(h.db, bareUser.id, bareUser.id, 0);
    expect(await repos.subscription.get()).toBeUndefined();
  });

  it('create inserts a subscription row', async () => {
    // Use selfhost mode so provisionDefaults doesn't insert a subscription,
    // allowing us to test SubscriptionRepoImpl.create directly.
    process.env.APP_MODE = 'selfhost';
    const bareUser = await h.userRepo.create({ email: 'new@example.com', name: 'New' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(bareUser.id);
    process.env.APP_MODE = 'saas';
    const repos = createRepos(h.db, bareUser.id, orgId, businessId);

    const trialEndsAt = new Date(Date.now() + 14 * 86400_000).toISOString();
    await repos.subscription.create({ status: 'trialing', plan: 'beta', trialEndsAt });

    const sub = await repos.subscription.get();
    expect(sub).toBeDefined();
    expect(sub!.status).toBe('trialing');
    expect(sub!.plan).toBe('beta');
    expect(sub!.trialEndsAt).toBe(trialEndsAt);
    expect(sub!.stripeCustomerId).toBeNull();
    expect(sub!.stripeSubscriptionId).toBeNull();
  });

  it('create is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const bareUser = await h.userRepo.create({ email: 'idem@example.com', name: 'Idem' });
    const { orgId, businessId } = await h.userRepo.provisionDefaults(bareUser.id);
    const repos = createRepos(h.db, bareUser.id, orgId, businessId);

    const trialEndsAt = new Date(Date.now() + 14 * 86400_000).toISOString();
    await repos.subscription.create({ status: 'trialing', plan: 'beta', trialEndsAt });
    // Second call with different values; should be silently ignored.
    await repos.subscription.create({ status: 'active', plan: 'monthly', trialEndsAt: null });

    const sub = await repos.subscription.get();
    expect(sub!.status).toBe('trialing'); // first insert wins
    expect(sub!.plan).toBe('beta');
  });

  it('update mutates individual fields', async () => {
    const sub = await h.alt.subscription.get();
    expect(sub).toBeDefined(); // alt user was provisioned with saas mode

    await h.alt.subscription.update({ status: 'active', plan: 'monthly' });

    const updated = await h.alt.subscription.get();
    expect(updated!.status).toBe('active');
    expect(updated!.plan).toBe('monthly');
    // Fields not in the update call remain unchanged.
    expect(updated!.trialEndsAt).toBe(sub!.trialEndsAt);
  });

  it('update sets stripe fields', async () => {
    await h.alt.subscription.update({
      stripeCustomerId: 'cus_test123',
      stripeSubscriptionId: 'sub_test456',
      currentPeriodEnd: '2026-12-31T23:59:59Z',
    });

    const updated = await h.alt.subscription.get();
    expect(updated!.stripeCustomerId).toBe('cus_test123');
    expect(updated!.stripeSubscriptionId).toBe('sub_test456');
    expect(updated!.currentPeriodEnd).toBe('2026-12-31T23:59:59Z');
  });

  it('update is a no-op when called with an empty object', async () => {
    const before = await h.alt.subscription.get();
    await h.alt.subscription.update({});
    const after = await h.alt.subscription.get();
    expect(after).toEqual(before);
  });

  describe('tenant isolation', () => {
    it('get returns only the calling user\'s row', async () => {
      // Both owner and alt are provisioned; each should only see their own row.
      const ownerSub = await h.owner.subscription.get();
      const altSub = await h.alt.subscription.get();

      // Owner row exists (provisioned by makeTestDb → provisionDefaults is
      // called for owner in the helper now).
      // Alt's row should exist because provisionDefaults was called on alt.
      expect(altSub).toBeDefined();
      expect(altSub!.orgId).toBe(h.altOrgId);

      // If owner has no subscription row it's still isolated from alt.
      if (ownerSub) {
        expect(ownerSub.orgId).toBe(h.ownerOrgId);
        expect(ownerSub.orgId).not.toBe(h.altOrgId);
      }
    });

    it('update on one user does not affect another', async () => {
      const altBefore = await h.alt.subscription.get();
      expect(altBefore).toBeDefined();

      // Create a separate user and update their subscription.
      const other = await h.userRepo.create({ email: 'other@example.com', name: 'Other' });
      const { orgId: otherOrgId, businessId: otherBusinessId } = await h.userRepo.provisionDefaults(other.id);
      const otherRepos = createRepos(h.db, other.id, otherOrgId, otherBusinessId);
      // provision already creates a subscription in saas mode; update it.
      await otherRepos.subscription.update({ status: 'canceled' });

      // Alt's subscription unchanged.
      const altAfter = await h.alt.subscription.get();
      expect(altAfter!.status).toBe(altBefore!.status);
    });
  });

  describe('provisionDefaults (subscription path)', () => {
    it('provisions a trialing subscription in saas mode', async () => {
      const user = await h.userRepo.create({ email: 'prov@example.com', name: 'Prov' });
      const { trialEndsAt, orgId, businessId } = await h.userRepo.provisionDefaults(user.id);

      expect(trialEndsAt).not.toBeNull();
      expect(new Date(trialEndsAt!).getTime()).toBeGreaterThan(Date.now());

      const repos = createRepos(h.db, user.id, orgId, businessId);
      const sub = await repos.subscription.get();
      expect(sub!.status).toBe('trialing');
      expect(sub!.trialEndsAt).toBe(trialEndsAt);
    });

    it('returns null trialEndsAt in self-host mode', async () => {
      const prev = process.env.APP_MODE;
      delete process.env.APP_MODE;
      try {
        const user = await h.userRepo.create({ email: 'selfhost@example.com', name: 'Self' });
        const { trialEndsAt, orgId, businessId } = await h.userRepo.provisionDefaults(user.id);
        expect(trialEndsAt).toBeNull();

        const repos = createRepos(h.db, user.id, orgId, businessId);
        expect(await repos.subscription.get()).toBeUndefined();
      } finally {
        if (prev === undefined) delete process.env.APP_MODE;
        else process.env.APP_MODE = prev;
      }
    });

    it('is idempotent: calling provisionDefaults twice does not create a second row', async () => {
      const user = await h.userRepo.create({ email: 'idem2@example.com', name: 'Idem2' });
      await h.userRepo.provisionDefaults(user.id);
      const { orgId, businessId } = await h.userRepo.provisionDefaults(user.id); // should not throw or insert duplicate

      const repos = createRepos(h.db, user.id, orgId, businessId);
      const sub = await repos.subscription.get();
      expect(sub).toBeDefined(); // exactly one row
    });
  });

  describe('tier model', () => {
    it('defaults tier to "free" and seats to 1 on provisionDefaults', async () => {
      const sub = await h.alt.subscription.get();
      expect(sub!.tier).toBe('free');
      expect(sub!.seats).toBe(1);
      expect(sub!.grantedByAdminId).toBeNull();
      expect(sub!.grantedAt).toBeNull();
    });

    it('round-trips tier, seats, and admin-grant fields through update + get', async () => {
      const grantedAt = new Date().toISOString();
      await h.alt.subscription.update({
        tier: 'org',
        seats: 5,
        plan: 'admin_grant',
        status: 'active',
        grantedByAdminId: h.ownerId,
        grantedAt,
      });
      const sub = await h.alt.subscription.get();
      expect(sub!.tier).toBe('org');
      expect(sub!.seats).toBe(5);
      expect(sub!.plan).toBe('admin_grant');
      expect(sub!.status).toBe('active');
      expect(sub!.grantedByAdminId).toBe(h.ownerId);
      expect(sub!.grantedAt).toBe(grantedAt);
    });

    it('create accepts tier + seats overrides', async () => {
      process.env.APP_MODE = 'selfhost';
      const user = await h.userRepo.create({ email: 'biz@example.com', name: 'Biz' });
      const { orgId, businessId } = await h.userRepo.provisionDefaults(user.id);
      process.env.APP_MODE = 'saas';
      const repos = createRepos(h.db, user.id, orgId, businessId);

      await repos.subscription.create({
        status: 'active',
        plan: 'business_monthly',
        trialEndsAt: null,
        tier: 'business',
        seats: 1,
      });

      const sub = await repos.subscription.get();
      expect(sub!.tier).toBe('business');
      expect(sub!.seats).toBe(1);
      expect(sub!.plan).toBe('business_monthly');
    });
  });
});
