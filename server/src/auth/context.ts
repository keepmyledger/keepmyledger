import { AppMode } from '@keepmyledger/shared';
import { Repos, createRepos, createUserRepo, OWNER_USER_ID } from '../repos/impl';
import { UserRepo } from '../repos/UserRepo';
import { DbAdapter } from '../db/adapter';
import { CategorizationService } from '../services/categorizationService';
import { ImportService } from '../services/importService';
import { StatementTrackingService } from '../services/statementTrackingService';
import { AiAssistService } from '../services/aiAssistService';
import { LlmBankHintRepoImpl } from '../repos/impl/LlmBankHintRepoImpl';

export interface RequestServices {
  categorization: CategorizationService;
  imports: ImportService;
  tracking: StatementTrackingService;
  aiAssist: AiAssistService;
}

export interface RequestContext {
  userId: string;
  repos: Repos;
  services: RequestServices;
}

/** Build all per-request repo + service instances bound to one userId. */
export function buildContext(db: DbAdapter, userId: string): RequestContext {
  const repos = createRepos(db, userId);
  const categorization = new CategorizationService(repos.rules, repos.transactions, repos.categories);
  const llmBankHintRepo = new LlmBankHintRepoImpl(db);
  const imports = new ImportService(repos.accounts, repos.statements, repos.transactions, categorization, llmBankHintRepo);
  const tracking = new StatementTrackingService(repos.accounts);
  const aiAssist = new AiAssistService({
    transactions: repos.transactions,
    categories: repos.categories,
    rules: repos.rules,
    accounts: repos.accounts,
  });
  return { userId, repos, services: { categorization, imports, tracking, aiAssist } };
}

export function getAppMode(): AppMode {
  return process.env.APP_MODE === 'saas' ? 'saas' : 'selfhost';
}

/**
 * Per-user daily cap on AI Assist requests. 0 means unlimited.
 *
 * Precedence:
 *   1. `AI_DAILY_LIMIT` env var if set (must parse as a non-negative integer).
 *   2. SaaS mode default: 100/day.
 *   3. Self-host default: unlimited (0).
 */
export function getAiDailyLimit(): number {
  const raw = process.env.AI_DAILY_LIMIT;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return getAppMode() === 'saas' ? 100 : 0;
}

/** Global, non-tenant-scoped repo for user/identity lookups. */
export function getUserRepo(db: DbAdapter): UserRepo {
  return createUserRepo(db);
}

export { OWNER_USER_ID };
