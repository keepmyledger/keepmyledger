// ─── Enums / union types ────────────────────────────────────────────────────

export type BankType = 'mt' | 'amex' | 'chase' | 'ofx' | 'unknown';
export type AccountKind = 'checking' | 'savings' | 'credit_card';
export type CategoryKind = 'expense' | 'income' | 'transfer';
export type PatternKind = 'substring' | 'regex';
export type CategorySource = 'rule' | 'suggested' | 'manual';
export type ParserUsed = 'template' | 'llm' | 'csv' | 'qif' | 'ofx' | 'generic';
export type AppMode = 'saas' | 'selfhost';
export type UnknownFormatStatus = 'pending' | 'in_progress' | 'done' | 'wont_implement';
export type AuthProvider = 'google' | 'facebook' | 'apple' | 'microsoft' | 'owner' | 'local';
export type SubscriptionTier = 'free' | 'business' | 'org';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
export type BillingInterval = 'monthly' | 'annual';

// ─── Entities ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  /** Explicit receipt-storage choice; null = follow server default. */
  receiptStoragePreference: ReceiptStoragePreference | null;
}

export interface AuthProviderInfo {
  id: AuthProvider;
  label: string;
}

// ─── Org / Business / Invite ────────────────────────────────────────────────

export interface Org {
  id: string;
  name: string;
  createdAt: string;
}

export interface OrgMember {
  userId: string;
  orgId: string;
  role: 'owner' | 'member';
  createdAt: string;
}

export interface Business {
  id: number;
  orgId: string;
  name: string;
  createdAt: string;
  /** Object-storage key for the logo, or null when no logo is set. */
  logoStorageKey: string | null;
  /** MIME type for the logo blob, e.g. "image/png". */
  logoContentType: string | null;
}

export type InviteStatus = 'pending' | 'accepted' | 'expired';

export interface OrgInvite {
  id: string;
  orgId: string;
  invitedBy: string;
  email: string;
  role: 'owner' | 'member';
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

export interface AppConfig {
  mode: AppMode;
  providers: AuthProviderInfo[];   // OAuth providers enabled at runtime
  billingEnabled: boolean;
  aiAssistEnabled: boolean;
  /** True when the server has an S3-compatible bucket configured for receipts. */
  kmlStorageAvailable: boolean;
  /** Backend used when the user has no explicit `receiptStoragePreference`. */
  defaultReceiptStorage: ReceiptStoragePreference;
  /** GA4 measurement ID (e.g. `G-XXXX`). `null` when unset — client must not load gtag. */
  gaMeasurementId: string | null;
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
  /** Whether this category counts as a business expense (default true). */
  isBusiness: boolean;
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

export type ReceiptStorageBackend = 'drive' | 's3';

/**
 * Per-user choice between KML's hosted S3 storage and the user's own Google
 * Drive. `null` = follow the server default (kml when configured and in SaaS
 * mode, drive otherwise).
 */
export type ReceiptStoragePreference = 'kml' | 'drive';

export interface Receipt {
  id: number;
  storageBackend: ReceiptStorageBackend;
  uploadedAt: string;
  /** Drive-backed fields (null for S3 receipts). */
  driveFileId: string | null;
  driveFileName: string | null;
  driveMimeType: string | null;
  driveWebViewLink: string | null;
  driveThumbnailLink: string | null;
  /** S3-backed fields (null for Drive receipts). Fetch bytes via GET /api/receipts/:id/download. */
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
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

export interface TransactionSplit {
  id: number;
  transactionId: number;
  categoryId: number;
  /** Signed amount; same sign as the parent transaction. */
  amount: number;
  note: string | null;
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
  /** Category splits, present when the transaction is split across categories. */
  splits?: TransactionSplit[];
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
  isBusiness?: boolean;
}

export interface UpdateCategoryPayload {
  name?: string;
  kind?: CategoryKind;
  taxExportCode?: string | null;
  isBusiness?: boolean;
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

export interface CreateReceiptFromS3Payload {
  storageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * One row that hash-matched an existing transaction in the database. The user
 * decides per-row whether to import it anyway (legit coincidence — e.g. two
 * identical Starbucks runs the same day across two imports) or skip it
 * (genuine re-import of a row that's already on the ledger).
 */
export interface PendingDuplicate {
  externalHash: string;
  parsed: {
    date: string;
    description: string;
    amount: number;
  };
  existing: Transaction;
}

export interface ImportResult {
  statementId: number;
  period: string;
  parserUsed: ParserUsed;
  /** Newly-inserted, non-duplicate rows. */
  transactionsImported: number;
  /** Rows held back for user review because they match an existing transaction by external_hash. */
  pendingReview: PendingDuplicate[];
  transactions: Transaction[];
}

/** Single-row decision passed to POST /api/imports/duplicates/resolve. */
export interface DuplicateDecision {
  externalHash: string;
  action: 'keep' | 'skip';
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
  /** 0..1 self-rated parser confidence. Omitted when the parser cannot estimate. */
  confidence?: number;
  /** Human-readable concerns the user should spot-check before committing. */
  warnings?: string[];
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
  kind: 'pdf' | 'csv' | 'qif' | 'ofx';
  parsed: ParsedStatementPreview | null;
  parseError?: string | null;
  csv?: CsvPreviewMeta;
  /** True when an LLM API key is configured and the user can request AI-assisted parsing. */
  llmAvailable?: boolean;
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

// ─── Unknown-format samples ──────────────────────────────────────────────────

export interface UnknownFormatSample {
  id: number;
  orgId: string;
  accountId: number | null;
  submittedAt: string;
  redactedText: string;
  bankHint: string | null;
  pageCount: number | null;
  fileSizeKb: number | null;
  previewToken: string | null;
  status: UnknownFormatStatus;
  adminNotes: string | null;
}
