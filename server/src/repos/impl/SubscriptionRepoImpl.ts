import { Subscription, SubscriptionRepo, SubscriptionStatus, SubscriptionTier } from '../SubscriptionRepo';
import { DbAdapter } from '../../db/adapter';

function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    orgId: row.org_id as string,
    status: row.status as SubscriptionStatus,
    plan: row.plan as string,
    tier: (row.tier as SubscriptionTier | null) ?? 'free',
    seats: Number(row.seats ?? 1),
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
    grantedByAdminId: (row.granted_by_admin_id as string | null) ?? null,
    grantedAt: (row.granted_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SubscriptionRepoImpl implements SubscriptionRepo {
  constructor(private db: DbAdapter, private orgId: string) {}

  async get(): Promise<Subscription | undefined> {
    const row = await this.db.get(
      'SELECT * FROM subscriptions WHERE org_id = ?',
      [this.orgId],
    );
    return row ? toSubscription(row) : undefined;
  }

  async create(
    data: Pick<Subscription, 'status' | 'plan' | 'trialEndsAt'> & Partial<Pick<Subscription, 'tier' | 'seats'>>,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO subscriptions(org_id, status, plan, tier, seats, trial_ends_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO NOTHING`,
      [this.orgId, data.status, data.plan, data.tier ?? 'free', data.seats ?? 1, data.trialEndsAt],
    );
  }

  async update(data: Partial<Pick<Subscription,
    | 'status'
    | 'plan'
    | 'tier'
    | 'seats'
    | 'trialEndsAt'
    | 'currentPeriodEnd'
    | 'stripeCustomerId'
    | 'stripeSubscriptionId'
    | 'grantedByAdminId'
    | 'grantedAt'
  >>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined)               { sets.push('status = ?');                  params.push(data.status); }
    if (data.plan !== undefined)                 { sets.push('plan = ?');                    params.push(data.plan); }
    if (data.tier !== undefined)                 { sets.push('tier = ?');                    params.push(data.tier); }
    if (data.seats !== undefined)                { sets.push('seats = ?');                   params.push(data.seats); }
    if (data.trialEndsAt !== undefined)          { sets.push('trial_ends_at = ?');           params.push(data.trialEndsAt); }
    if (data.currentPeriodEnd !== undefined)     { sets.push('current_period_end = ?');      params.push(data.currentPeriodEnd); }
    if (data.stripeCustomerId !== undefined)     { sets.push('stripe_customer_id = ?');      params.push(data.stripeCustomerId); }
    if (data.stripeSubscriptionId !== undefined) { sets.push('stripe_subscription_id = ?'); params.push(data.stripeSubscriptionId); }
    if (data.grantedByAdminId !== undefined)     { sets.push('granted_by_admin_id = ?');     params.push(data.grantedByAdminId); }
    if (data.grantedAt !== undefined)            { sets.push('granted_at = ?');              params.push(data.grantedAt); }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(this.orgId);

    await this.db.run(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE org_id = ?`,
      params,
    );
  }

  async updateByStripeCustomerId(
    customerId: string,
    data: Partial<Pick<Subscription, 'status' | 'currentPeriodEnd' | 'tier' | 'seats' | 'stripeSubscriptionId'>>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined)               { sets.push('status = ?');                  params.push(data.status); }
    if (data.currentPeriodEnd !== undefined)     { sets.push('current_period_end = ?');      params.push(data.currentPeriodEnd); }
    if (data.tier !== undefined)                 { sets.push('tier = ?');                    params.push(data.tier); }
    if (data.seats !== undefined)                { sets.push('seats = ?');                   params.push(data.seats); }
    if (data.stripeSubscriptionId !== undefined) { sets.push('stripe_subscription_id = ?'); params.push(data.stripeSubscriptionId); }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(customerId);

    await this.db.run(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE stripe_customer_id = ?`,
      params,
    );
  }
}
