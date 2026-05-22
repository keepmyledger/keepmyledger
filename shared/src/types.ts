// ─── Enums / union types ────────────────────────────────────────────────────

export type BankType = 'mt' | 'amex' | 'chase' | 'unknown';
export type AccountKind = 'checking' | 'savings' | 'credit_card';
export type CategoryKind = 'expense' | 'income' | 'transfer';
export type PatternKind = 'substring' | 'regex';
export type CategorySource = 'rule' | 'suggested' | 'manual';
export type ParserUsed = 'template' | 'llm' | 'csv' | 'qif';
export type AppMode = 'saas' | 'selfhost';
export type AuthProvider = 'google' | 'facebook' | 'apple' | 'owner' | 'local';

// ─── Entities ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthProviderInfo {
  id: AuthProvider;
  label: string;
}

export interface AppConfig {
  mode: AppMode;
  providers: AuthProviderInfo[];   // OAuth providers enabled at runtime
  billingEnabled: boolean;
  aiAssistEnabled: boolean;
}

export interface CsvColumnMapping {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
}

export interface Account {
  id: number;
  name: string;
  bankType: BankType;
  accountKind: AccountKind;
  /** Most recently imported statement period, e.g. "2026-04" */
  lastStatementPeriod: string | null;
  createdAt: string; // ISO 8601
  /** Remembered CSV column mapping for repeat imports from the same bank. */
  csvMapping: CsvColumnMapping | null;
}

export interface Statement {
  id: number;
  accountId: number;
  /** YYYY-MM */
  period: string;
  sourcePdfPath: string;
  parserUsed: ParserUsed;
  importedAt: string;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  /** Optional code used in tax export grouping */
  taxExportCode: string | null;
}

export interface Rule {
  id: number;
  name: string;
  descriptionPattern: string;
  patternKind: PatternKind;
  amountMin: number | null;
  amountMax: number | null;
  /** null = applies to all accounts */
  accountId: number | null;
  categoryId: number;
  priority: number;
  /** Optional tax/audit description applied to matching transactions when they don't have one. */
  taxDescription: string | null;
  createdAt: string;
}

export interface Receipt {
  id: number;
  driveFileId: string;
  driveFileName: string;
  driveMimeType: string | null;
  driveWebViewLink: string | null;
  driveThumbnailLink: string | null;
  uploadedAt: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  thumbnailLink: string | null;
  modifiedTime: string | null;
}

export interface DriveAuthStatus {
  authenticated: boolean;
  configured: boolean; // GOOGLE_CLIENT_ID is set
}

export interface Transaction {
  id: number;
  accountId: number;
  statementId: number;
  date: string; // YYYY-MM-DD
  description: string;
  /** Signed: negative = expense, positive = income */
  amount: number;
  categoryId: number | null;
  categorySource: CategorySource | null;
  suggestedCategoryId: number | null;
  ruleId: number | null;
  /** Receipts linked to this transaction (populated by API when requested) */
  receipts?: Receipt[];
  notes: string | null;
  /** Business-purpose / audit-justification description (distinct from the bank `description`). */
  taxDescription: string | null;
}

// ─── API payloads ────────────────────────────────────────────────────────────

export interface CreateAccountPayload {
  name: string;
  bankType: BankType;
  accountKind: AccountKind;
}

export interface UpdateAccountPayload {
  name?: string;
  bankType?: BankType;
  accountKind?: AccountKind;
  lastStatementPeriod?: string;
  csvMapping?: CsvColumnMapping | null;
}

export interface CreateCategoryPayload {
  name: string;
  kind: CategoryKind;
  taxExportCode?: string | null;
}

export interface UpdateCategoryPayload {
  name?: string;
  kind?: CategoryKind;
  taxExportCode?: string | null;
}

export interface CreateRulePayload {
  name: string;
  descriptionPattern: string;
  patternKind: PatternKind;
  amountMin?: number | null;
  amountMax?: number | null;
  accountId?: number | null;
  categoryId: number;
  priority?: number;
  taxDescription?: string | null;
}

export interface UpdateRulePayload {
  name?: string;
  descriptionPattern?: string;
  patternKind?: PatternKind;
  amountMin?: number | null;
  amountMax?: number | null;
  accountId?: number | null;
  categoryId?: number;
  priority?: number;
  taxDescription?: string | null;
}

export interface UpdateTransactionPayload {
  date?: string;          // YYYY-MM-DD
  description?: string;
  amount?: number;        // Signed: negative = expense, positive = income
  categoryId?: number | null;
  categorySource?: CategorySource;
  notes?: string | null;
  taxDescription?: string | null;
}

export interface LinkReceiptPayload {
  receiptId: number;
}

export interface CreateReceiptFromDrivePayload {
  driveFileId: string;
  driveFileName: string;
  driveMimeType?: string | null;
  driveWebViewLink?: string | null;
  driveThumbnailLink?: string | null;
}

export interface ImportResult {
  statementId: number;
  period: string;
  parserUsed: ParserUsed;
  transactionsImported: number;
  transactionsDuplicated: number;
  transactions: Transaction[];
}

/** Parsed (but not yet persisted) statement returned by /imports/preview. */
export interface ParsedStatementPreview {
  period: string;
  parserUsed: ParserUsed;
  transactions: Array<{
    date: string;          // YYYY-MM-DD
    description: string;
    amount: number;        // signed: negative = expense
  }>;
  detectedMapping?: CsvColumnMapping | null;
  delimiter?: string;
}

export interface CsvPreviewMeta {
  delimiter: string;
  hasHeader: boolean;
  header: string[] | null;
  detectedMapping: CsvColumnMapping | null;
  appliedMapping: CsvColumnMapping | null;
  sampleRows: string[][];
  totalRows: number;
}

export interface PreviewResponse {
  token: string;
  kind: 'pdf' | 'csv' | 'qif';
  parsed: ParsedStatementPreview | null;
  parseError?: string | null;
  csv?: CsvPreviewMeta;
}

export interface CommitPayload {
  token: string;
  accountId: number;
  mapping?: CsvColumnMapping | null;
  rememberMapping?: boolean;
}

export interface StartupCheckResult {
  missingStatements: Array<{
    account: Account;
    missingPeriod: string; // YYYY-MM
  }>;
}

export interface ReportByCategoryRow {
  categoryId: number | null;
  categoryName: string | null;
  kind: CategoryKind | null;
  total: number;
}

export interface CashflowRow {
  period: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
}

// ─── AI Assist ──────────────────────────────────────────────────────────────

export interface ProposedRule {
  name: string;
  descriptionPattern: string;
  patternKind: PatternKind;
  amountMin?: number | null;
  amountMax?: number | null;
  accountId?: number | null;
  categoryId: number;
  taxDescription?: string | null;
}

export interface AiSuggestion {
  categoryId: number | null;
  categoryName: string | null;
  confidence: number; // 0..1
  taxDescription: string | null;
  rationale: string | null;
  proposedRule: ProposedRule | null;
}
