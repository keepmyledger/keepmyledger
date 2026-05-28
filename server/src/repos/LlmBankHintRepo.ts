/**
 * Tracks LLM-fallback usage per bank and stores generated column-structure
 * hints once a bank's hit count crosses the analysis threshold.
 *
 * This is a global (non-user-scoped) repo; one row per unique bank name
 * across all users.
 */
export interface LlmBankHintRow {
  bankName: string;
  llmHitCount: number;
  /** JSON string describing column structure; null until generated. */
  columnHint: string | null;
  hintGeneratedAt: string | null;
}

export interface LlmBankHintRepo {
  /**
   * Atomically increments the hit counter for the given (normalised) bank
   * name and returns the new count plus any existing column hint.
   */
  incrementHitCount(bankName: string): Promise<{ count: number; columnHint: string | null }>;

  /** Stores the LLM-generated column-structure description for a bank. */
  saveColumnHint(bankName: string, hint: string): Promise<void>;

  /** Returns all rows ordered by hit count descending. */
  list(): Promise<LlmBankHintRow[]>;
}
