import { AccountRepo } from '../AccountRepo';
import { CategoryRepo } from '../CategoryRepo';
import { RuleRepo } from '../RuleRepo';
import { StatementRepo } from '../StatementRepo';
import { TransactionRepo } from '../TransactionRepo';
import { ReceiptRepo } from '../ReceiptRepo';
import { UserRepo } from '../UserRepo';
import { AiUsageRepo } from '../AiUsageRepo';
import { SubscriptionRepo } from '../SubscriptionRepo';
import { OrgRepo } from '../OrgRepo';
import { BusinessRepo } from '../BusinessRepo';
import { InviteRepo } from '../InviteRepo';
import { DbAdapter } from '../../db/adapter';
import { AccountRepoImpl } from './AccountRepoImpl';
import { CategoryRepoImpl } from './CategoryRepoImpl';
import { RuleRepoImpl } from './RuleRepoImpl';
import { StatementRepoImpl } from './StatementRepoImpl';
import { TransactionRepoImpl } from './TransactionRepoImpl';
import { ReceiptRepoImpl } from './ReceiptRepoImpl';
import { UserRepoImpl } from './UserRepoImpl';
import { AiUsageRepoImpl } from './AiUsageRepoImpl';
import { SubscriptionRepoImpl } from './SubscriptionRepoImpl';
import { OrgRepoImpl } from './OrgRepoImpl';
import { BusinessRepoImpl } from './BusinessRepoImpl';
import { InviteRepoImpl } from './InviteRepoImpl';

export interface Repos {
  // Business-scoped (data isolation by businessId)
  accounts: AccountRepo;
  categories: CategoryRepo;
  rules: RuleRepo;
  statements: StatementRepo;
  transactions: TransactionRepo;
  receipts: ReceiptRepo;
  // User-scoped (per-user daily quota)
  aiUsage: AiUsageRepo;
  // Org-scoped
  subscription: SubscriptionRepo;
  businesses: BusinessRepo;
  invites: InviteRepo;
  // User-scoped (org membership lookups)
  org: OrgRepo;
}

/**
 * Build a fully-scoped Repos bundle.
 *
 * @param db        Database adapter (SQLite or Postgres).
 * @param userId    The authenticated user's id (scopes aiUsage, org, invites).
 * @param orgId     The active organization id (scopes subscription, businesses, invites).
 * @param businessId The active business id (scopes all data tables).
 */
export function createRepos(db: DbAdapter, userId: string, orgId: string, businessId: number): Repos {
  return {
    accounts: new AccountRepoImpl(db, businessId),
    categories: new CategoryRepoImpl(db, businessId),
    rules: new RuleRepoImpl(db, businessId),
    statements: new StatementRepoImpl(db, businessId),
    transactions: new TransactionRepoImpl(db, businessId),
    receipts: new ReceiptRepoImpl(db, businessId),
    aiUsage: new AiUsageRepoImpl(db, userId),
    subscription: new SubscriptionRepoImpl(db, orgId),
    businesses: new BusinessRepoImpl(db, orgId, userId),
    invites: new InviteRepoImpl(db, orgId, userId),
    org: new OrgRepoImpl(db, userId),
  };
}

/** UserRepo is not user-scoped; it manages user records themselves. */
export function createUserRepo(db: DbAdapter): UserRepo {
  return new UserRepoImpl(db);
}

/**
 * Returns a SubscriptionRepo instance not bound to any org.
 * Only `updateByStripeCustomerId` is safe to call on this instance.
 * Used by Stripe webhook handlers where the org_id is not known upfront.
 */
export function createGlobalSubscriptionRepo(db: DbAdapter): Pick<SubscriptionRepo, 'updateByStripeCustomerId'> {
  return new SubscriptionRepoImpl(db, '');
}

export { OWNER_USER_ID } from './UserRepoImpl';
