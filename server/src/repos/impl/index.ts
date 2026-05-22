import { AccountRepo } from '../AccountRepo';
import { CategoryRepo } from '../CategoryRepo';
import { RuleRepo } from '../RuleRepo';
import { StatementRepo } from '../StatementRepo';
import { TransactionRepo } from '../TransactionRepo';
import { ReceiptRepo } from '../ReceiptRepo';
import { UserRepo } from '../UserRepo';
import { AiUsageRepo } from '../AiUsageRepo';
import { SubscriptionRepo } from '../SubscriptionRepo';
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

export interface Repos {
  accounts: AccountRepo;
  categories: CategoryRepo;
  rules: RuleRepo;
  statements: StatementRepo;
  transactions: TransactionRepo;
  receipts: ReceiptRepo;
  aiUsage: AiUsageRepo;
  subscription: SubscriptionRepo;
}

/**
 * Build a user-scoped Repos bundle backed by the given DbAdapter.
 * The same implementations work for both SQLite and Postgres.
 */
export function createRepos(db: DbAdapter, userId: string): Repos {
  return {
    accounts: new AccountRepoImpl(db, userId),
    categories: new CategoryRepoImpl(db, userId),
    rules: new RuleRepoImpl(db, userId),
    statements: new StatementRepoImpl(db, userId),
    transactions: new TransactionRepoImpl(db, userId),
    receipts: new ReceiptRepoImpl(db, userId),
    aiUsage: new AiUsageRepoImpl(db, userId),
    subscription: new SubscriptionRepoImpl(db, userId),
  };
}

/** UserRepo is not user-scoped; it manages user records themselves. */
export function createUserRepo(db: DbAdapter): UserRepo {
  return new UserRepoImpl(db);
}

export { OWNER_USER_ID } from './UserRepoImpl';
