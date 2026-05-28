/**
 * Unit tests for backfillSubscriptionTiers.ts
 *
 * Validates that the backfill correctly derives `tier` from various pre-PR
 * `plan` values and from the `stripe_subscription_id` fallback signal.
 */
import { makeTestDb, TestDb } from '../helpers/db';
import { backfillTiers } from '../../scripts/backfillSubscriptionTiers';

describe('backfillTiers', () => {
  let h: TestDb;

  beforeEach(async () => {
    h = await makeTestDb();
    // Explicitly seed the owner subscription. provisionDefaults only creates
    // one when APP_MODE=saas, but the backfill tests need a row regardless of
    // mode (CI runs APP_MODE=selfhost). The tests below mutate this row via
    // update() to exercise different plan strings.
    await h.owner.subscription.create({ status: 'trialing', plan: 'beta', trialEndsAt: null });
  });

  afterEach(() => h.close());

  it('upgrades plan=monthly to tier=business', async () => {
    await h.owner.subscription.update({ plan: 'monthly', status: 'active' });

    const count = await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('business');
    expect(sub?.seats).toBe(1);
    expect(count).toBe(1);
  });

  it('upgrades plan=annual to tier=business', async () => {
    await h.owner.subscription.update({ plan: 'annual', status: 'active' });

    await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('business');
    expect(sub?.seats).toBe(1);
  });

  // ── New-style plan strings (from this PR) ─────────────────────────────────

  it('upgrades plan=business_monthly to tier=business', async () => {
    await h.owner.subscription.update({ plan: 'business_monthly', status: 'active' });

    await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('business');
  });

  it('upgrades plan=org_annual to tier=org with 3 seats', async () => {
    await h.owner.subscription.update({ plan: 'org_annual', status: 'active' });

    await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('org');
    expect(sub?.seats).toBe(3);
  });

  // ── Stripe sub ID fallback ─────────────────────────────────────────────────

  it('upgrades unrecognised plan to business when stripe_subscription_id is set', async () => {
    await h.owner.subscription.update({ plan: 'legacy_plan', status: 'active', stripeSubscriptionId: 'sub_legacy123' });

    await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('business');
  });

  // ── No-op cases ───────────────────────────────────────────────────────────

  it('leaves tier=free rows with plan=trialing unchanged', async () => {
    await h.owner.subscription.update({ plan: 'trialing', status: 'trialing' });

    const count = await backfillTiers(h.db);

    const sub = await h.owner.subscription.get();
    expect(sub?.tier).toBe('free');
    expect(count).toBe(0);
  });

  it('is idempotent — skips rows already on a paid tier', async () => {
    // Manually set plan + tier to simulate a row already backfilled.
    await h.db.run(
      `UPDATE subscriptions SET plan = 'monthly', tier = 'business' WHERE org_id = ?`,
      [h.ownerOrgId],
    );

    const count = await backfillTiers(h.db);

    expect(count).toBe(0);
  });
});
