import { Transaction, UpdateTransactionPayload, CategoryKind } from '@keepmyledger/shared';

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
  /** Bulk-insert transactions; skips duplicates by external_hash. Returns inserted count. */
  bulkCreate(transactions: Omit<Transaction, 'id'>[]): Promise<{ inserted: number; skipped: number }>;
  update(id: number, payload: UpdateTransactionPayload): Promise<Transaction | undefined>;
  /** Directly set the rule_id column (used after a categorization decision). */
  setRuleId(id: number, ruleId: number | null): Promise<void>;
  /** Directly set the suggested_category_id column. */
  setSuggestedCategoryId(id: number, categoryId: number | null): Promise<void>;
  delete(id: number): Promise<boolean>;
  /** Delete multiple transactions at once. Returns the number actually deleted. */
  bulkDelete(ids: number[]): Promise<number>;
  /** Aggregate spend/income by category, optionally filtered by year */
  reportByCategory(year?: number): Promise<ReportByCategoryRow[]>;
  /** Monthly cashflow summary */
  reportCashflow(year?: number): Promise<CashflowRow[]>;
}
