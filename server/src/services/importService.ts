import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { ImportResult, AccountKind, CsvColumnMapping } from '@keepmyledger/shared';
import { AccountRepo } from '../repos/AccountRepo';
import { StatementRepo } from '../repos/StatementRepo';
import { TransactionRepo } from '../repos/TransactionRepo';
import { parseStatement } from '../parsers';
import { parseCsv } from '../parsers/csv';
import { parseQif } from '../parsers/qif';
import { ParsedStatement } from '../parsers/types';
import { extractPositionedText, groupByLine } from '../parsers/pdfPositional';
import { hashTransaction } from '../parsers/utils';
import { llmParser } from '../parsers/llm';
import { CategorizationService } from './categorizationService';
import { LlmBankHintRepo } from '../repos/LlmBankHintRepo';

/** Trigger the column-structure analysis after this many LLM hits per bank. */
const LLM_HINT_THRESHOLD = 10;

export class ImportService {
  constructor(
    private accountRepo: AccountRepo,
    private statementRepo: StatementRepo,
    private txRepo: TransactionRepo,
    private categorizationService: CategorizationService,
    private llmBankHintRepo?: LlmBankHintRepo
  ) {}

  // ── Preview (parse only, no persistence) ────────────────────────────────

  async previewPdf(filePath: string): Promise<ParsedStatement> {
    const buffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;
    let positional;
    try {
      const items = await extractPositionedText(buffer);
      positional = groupByLine(items);
    } catch (err) {
      console.warn('[import] positional extraction failed, continuing with text-only:', err);
    }
    const parsed = await parseStatement(text, { positional });

    if (parsed.parserUsed === 'llm' && parsed.bankName && this.llmBankHintRepo) {
      this.trackLlmHit(parsed.bankName, text).catch((err) => {
        console.warn('[import] llm bank hint tracking failed:', err);
      });
    }

    return parsed;
  }

  private async trackLlmHit(bankName: string, text: string): Promise<void> {
    if (!this.llmBankHintRepo) return;
    const normalized = bankName.trim().toLowerCase();
    const { count, columnHint } = await this.llmBankHintRepo.incrementHitCount(normalized);
    console.log(`[import] LLM bank hit: "${normalized}" count=${count}`);

    if (count === LLM_HINT_THRESHOLD && columnHint === null) {
      console.log(`[import] Generating column structure hint for "${normalized}" (${count} hits)`);
      try {
        const hint = await llmParser.describeColumnStructure(text, bankName);
        await this.llmBankHintRepo.saveColumnHint(normalized, hint);
        console.log(`[import] Column hint saved for "${normalized}"`);
      } catch (err) {
        console.warn(`[import] Failed to generate column hint for "${normalized}":`, err);
      }
    }
  }

  async previewCsv(filePath: string, mapping?: CsvColumnMapping): Promise<ParsedStatement> {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseCsv(text, mapping ? { mapping } : undefined);
  }

  async previewQif(filePath: string): Promise<ParsedStatement> {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseQif(text);
  }

  // ── One-shot import (back-compat) ────────────────────────────────────────

  async importPdf(accountId: number, filePath: string): Promise<ImportResult> {
    const parsed = await this.previewPdf(filePath);
    return this.persistParsed(accountId, filePath, parsed);
  }

  async importCsv(accountId: number, filePath: string, mapping?: CsvColumnMapping): Promise<ImportResult> {
    const parsed = await this.previewCsv(filePath, mapping);
    return this.persistParsed(accountId, filePath, parsed);
  }

  async importQif(accountId: number, filePath: string): Promise<ImportResult> {
    const parsed = await this.previewQif(filePath);
    return this.persistParsed(accountId, filePath, parsed);
  }

  // ── Commit (persist already-parsed result) ───────────────────────────────

  async persistParsed(
    accountId: number,
    filePath: string,
    parsed: ParsedStatement
  ): Promise<ImportResult> {
    const account = await this.accountRepo.findById(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    // Upsert statement row (idempotent — UNIQUE on account_id + period)
    let statement = await this.statementRepo.findByAccountAndPeriod(accountId, parsed.period);
    if (!statement) {
      statement = await this.statementRepo.create({
        accountId,
        period: parsed.period,
        sourcePdfPath: path.resolve(filePath),
        parserUsed: parsed.parserUsed,
      });
    }

    // Prepare transactions with hashes, flipping sign for credit cards.
    // Template PDF parsers return amounts in bank convention (charges positive,
    // payments negative as printed on the statement); flip those so storage
    // convention is consistent (negative = expense, positive = income).
    // The LLM and CSV parsers already return storage convention, so do not flip.
    const isCreditCard = account.accountKind === 'credit_card';
    const shouldFlipSign = isCreditCard && parsed.parserUsed === 'template';
    const toInsert = parsed.transactions.map((t) => {
      const amount = shouldFlipSign ? -t.amount : t.amount;
      const hash = hashTransaction(accountId, t.date, t.description, amount);
      return {
        accountId,
        statementId: statement!.id,
        date: t.date,
        description: t.description,
        amount,
        categoryId: null,
        categorySource: null,
        suggestedCategoryId: null,
        ruleId: null,
        hasReceipt: false,
        notes: null,
        taxDescription: null,
        externalHash: hash,
      };
    });

    // Bulk insert with dedup
    const { inserted, skipped } = await this.txRepo.bulkCreate(
      toInsert as Parameters<typeof this.txRepo.bulkCreate>[0]
    );

    // Update account's last statement period if newer
    if (
      !account.lastStatementPeriod ||
      parsed.period > account.lastStatementPeriod
    ) {
      await this.accountRepo.updateLastStatementPeriod(accountId, parsed.period);
    }

    // Fetch the newly inserted transactions and categorize them
    const newTxs = await this.txRepo.findAll({ statementId: statement.id });
    await this.categorizationService.categorizeAll(newTxs);

    // Re-fetch with categories populated
    const categorizedTxs = await this.txRepo.findAll({ statementId: statement.id });

    return {
      statementId: statement.id,
      period: parsed.period,
      parserUsed: parsed.parserUsed,
      transactionsImported: inserted,
      transactionsDuplicated: skipped,
      transactions: categorizedTxs,
    };
  }
}
