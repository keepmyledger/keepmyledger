import { Subscription, SubscriptionRepo, SubscriptionStatus } from '../SubscriptionRepo';
import { DbAdapter } from '../../db/adapter';

function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    userId: row.user_id as string,
    status: row.status as SubscriptionStatus,
    plan: row.plan as string,
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SubscriptionRepoImpl implements SubscriptionRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async get(): Promise<Subscription | undefined> {
    const row = await this.db.get(
      'SELECT * FROM subscriptions WHERE user_id = ?',
      [this.userId],
    );
    return row ? toSubscription(row) : undefined;
  }

  async create(data: Pick<Subscription, 'status' | 'plan' | 'trialEndsAt'>): Promise<void> {
    await this.db.run(
      `INSERT INTO subscriptions(user_id, status, plan, trial_ends_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      [this.userId, data.status, data.plan, data.trialEndsAt],
    );
  }

  async update(data: Partial<Pick<Subscription, 'status' | 'plan' | 'trialEndsAt' | 'currentPeriodEnd' | 'stripeCustomerId' | 'stripeSubscriptionId'>>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined)               { sets.push('status = ?');                  params.push(data.status); }
    if (data.plan !== undefined)                 { sets.push('plan = ?');                    params.push(data.plan); }
    if (data.trialEndsAt !== undefined)          { sets.push('trial_ends_at = ?');           params.push(data.trialEndsAt); }
    if (data.currentPeriodEnd !== undefined)     { sets.push('current_period_end = ?');      params.push(data.currentPeriodEnd); }
    if (data.stripeCustomerId !== undefined)     { sets.push('stripe_customer_id = ?');      params.push(data.stripeCustomerId); }
    if (data.stripeSubscriptionId !== undefined) { sets.push('stripe_subscription_id = ?'); params.push(data.stripeSubscriptionId); }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(this.userId);

    await this.db.run(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE user_id = ?`,
      params,
    );
  }
}
