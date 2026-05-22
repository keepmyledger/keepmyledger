import { LlmBankHintRepo, LlmBankHintRow } from '../LlmBankHintRepo';
import { DbAdapter } from '../../db/adapter';

export class LlmBankHintRepoImpl implements LlmBankHintRepo {
  constructor(private db: DbAdapter) {}

  async incrementHitCount(bankName: string): Promise<{ count: number; columnHint: string | null }> {
    const row = await this.db.get<{ llm_hit_count: number; column_hint: string | null }>(
      `INSERT INTO llm_bank_hints(bank_name, llm_hit_count) VALUES (?, 1)
       ON CONFLICT(bank_name) DO UPDATE SET llm_hit_count = llm_bank_hints.llm_hit_count + 1
       RETURNING llm_hit_count, column_hint`,
      [bankName],
    );
    return { count: Number(row!.llm_hit_count), columnHint: row!.column_hint ?? null };
  }

  async saveColumnHint(bankName: string, hint: string): Promise<void> {
    await this.db.run(
      `UPDATE llm_bank_hints SET column_hint = ?, hint_generated_at = ? WHERE bank_name = ?`,
      [hint, new Date().toISOString(), bankName],
    );
  }

  async list(): Promise<LlmBankHintRow[]> {
    const rows = await this.db.all<{
      bank_name: string;
      llm_hit_count: number;
      column_hint: string | null;
      hint_generated_at: string | null;
    }>('SELECT * FROM llm_bank_hints ORDER BY llm_hit_count DESC', []);
    return rows.map((r) => ({
      bankName: r.bank_name,
      llmHitCount: Number(r.llm_hit_count),
      columnHint: r.column_hint ?? null,
      hintGeneratedAt: r.hint_generated_at ?? null,
    }));
  }
}
