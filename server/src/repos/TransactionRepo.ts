import { Transaction, TransactionSplit, UpdateTransactionPayload, CategoryKind } from '@keepmyledger/shared';

export interface TransactionFilter {
  accountId?: number;
  statementId?: number;
  categoryId?: number | null;
  dateFrom?: string;
  dateTo?: string;
  hasReceipts?: boolean;
  categorySource?: string;
  uncategorized?: boolean;
  kind?: CategoryKind;
}

export interface ReportByCategoryRow {
  categoryId: number | null;
  categoryName: string | null;
  kind: CategoryKind | null;
  total: number;
}

export interface CashflowRow {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

export interface TransactionRepo {
  findAll(filter?: TransactionFilter): Promise<Transaction[]>;
  findById(id: number): Promise<Transaction | undefined>;
  findByHash(hash: string): Promise<Transaction | undefined>;
  /**
   * Look up which of the given `external_hash` values already exist for this
   * account in the database. Used by importService to partition incoming
   * transactions into "fresh" (insert immediately) vs "pending review" (the
   * user must decide whether to import a possible duplicate).
   */
  findExistingHashes(accountId: number, hashes: string[]): Promise<Set<string>>;
  /**
   * Bulk-insert transactions. No longer relies on a UNIQUE constraint — every
   * row passed in is inserted. Cross-import dedup is the caller's job.
   */
  bulkCreate(transactions: Omit<Transaction, 'id'>[]): Promise<{ inserted: number }>;
  update(id: number, payload: UpdateTransactionPayload): Promise<Transaction | undefined>;
  /** Directly set the rule_id column (used after a categorization decision). */
  setRuleId(id: number, ruleId: number | null): Promise<void>;
  /** Directly set the suggested_category_id column. */
  setSuggestedCategoryId(id: number, categoryId: number | null): Promise<void>;
  delete(id: number): Promise<boolean>;
  /** Delete multiple transactions at once. Returns the number actually deleted. */
  bulkDelete(ids: number[]): Promise<number>;
  /** Aggregate spend/income by category, optionally filtered by year.
   *  Split transactions contribute their split amounts to each split category
   *  rather than their parent category. */
  reportByCategory(year?: number): Promise<ReportByCategoryRow[]>;
  /** Monthly cashflow summary */
  reportCashflow(year?: number): Promise<CashflowRow[]>;
  /** Return all splits for a transaction that belongs to this user. */
  getSplits(transactionId: number): Promise<TransactionSplit[]>;
  /**
   * Atomically replace all splits for a transaction.
   * Pass an empty array to clear splits.
   * Returns the saved splits.
   */
  replaceSplits(transactionId: number, splits: Array<{ categoryId: number; amount: number; note?: string | null }>): Promise<TransactionSplit[]>;
}
