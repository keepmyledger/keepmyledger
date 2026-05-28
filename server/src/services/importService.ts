import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { ImportResult, AccountKind, CsvColumnMapping, PendingDuplicate, Transaction } from '@keepmyledger/shared';
import { AccountRepo } from '../repos/AccountRepo';
import { StatementRepo } from '../repos/StatementRepo';
import { TransactionRepo } from '../repos/TransactionRepo';
import { parseStatement, parseStatementWithLlm, llmParser } from '../parsers';
import { parseCsv } from '../parsers/csv';
import { parseQif } from '../parsers/qif';
import { parseOfx } from '../parsers/ofx';
import { ParsedStatement } from '../parsers/types';
import { extractPositionedText, groupByLine } from '../parsers/pdfPositional';
import { hashTransaction } from '../parsers/utils';
import { CategorizationService } from './categorizationService';
import { LlmBankHintRepo } from '../repos/LlmBankHintRepo';

/** Save the column-structure hint on the first LLM use per bank. */
const LLM_HINT_THRESHOLD = 1;

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
    let pdfData: Awaited<ReturnType<typeof pdfParse>>;
    try {
      pdfData = await pdfParse(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/password|encrypt/i.test(msg)) {
        throw new Error(
          'This PDF is password-protected. Remove the password in your PDF viewer and try again.'
        );
      }
      throw err;
    }
    const text = pdfData.text;
    // Image-only PDFs have a text layer with virtually no content.
    if (text.trim().length < 50) {
      throw new Error(
        'This PDF appears to be image-based and contains no extractable text. ' +
        'Export a text-based PDF from your bank\'s website and try again.'
      );
    }
    let positional;
    try {
      const items = await extractPositionedText(buffer);
      positional = groupByLine(items);
    } catch (err) {
      console.warn('[import] positional extraction failed, continuing with text-only:', err);
    }
    // Never auto-invokes LLM — returns template or generic result only.
    // Call previewPdfWithLlm() after obtaining explicit user consent.
    return parseStatement(text, { positional });
  }

  /** Parse with the LLM after the user has explicitly consented. */
  async previewPdfWithLlm(filePath: string, accountKind?: AccountKind): Promise<ParsedStatement> {
    const buffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;
    const parsed = await parseStatementWithLlm(text, accountKind);

    if (parsed.bankName && this.llmBankHintRepo) {
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

  async previewOfx(filePath: string): Promise<ParsedStatement> {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseOfx(text);
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

  async importOfx(accountId: number, filePath: string): Promise<ImportResult> {
    const parsed = await this.previewOfx(filePath);
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

    // Upsert statement row (idempotent; UNIQUE on account_id + period)
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
    const prepared = parsed.transactions.map((t) => {
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
        notes: null,
        taxDescription: null,
        externalHash: hash,
      };
    });

    // Partition: rows whose hash already exists in the DB are held back for
    // user review (cross-import duplicate). In-file dups — i.e. two prepared
    // rows in this batch sharing a hash — are intentionally allowed through
    // (per #80: same-file dups are almost always legit, e.g. two $5 coffees
    // on the same day).
    const existingHashes = await this.txRepo.findExistingHashes(
      accountId,
      prepared.map((p) => p.externalHash),
    );
    const toInsert: typeof prepared = [];
    const pendingHashes: string[] = [];
    const parsedByHash = new Map<string, typeof prepared[number]>();
    for (const p of prepared) {
      if (existingHashes.has(p.externalHash)) {
        if (!parsedByHash.has(p.externalHash)) {
          parsedByHash.set(p.externalHash, p);
          pendingHashes.push(p.externalHash);
        }
      } else {
        toInsert.push(p);
      }
    }

    const { inserted } = await this.txRepo.bulkCreate(
      toInsert as Parameters<typeof this.txRepo.bulkCreate>[0],
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

    // Build pendingReview by looking up each held-back hash's existing row.
    const pendingReview: PendingDuplicate[] = [];
    for (const hash of pendingHashes) {
      const parsedRow = parsedByHash.get(hash)!;
      const existing = await this.txRepo.findByHash(hash);
      if (!existing) continue; // shouldn't happen — defensive
      pendingReview.push({
        externalHash: hash,
        parsed: {
          date: parsedRow.date,
          description: parsedRow.description,
          amount: parsedRow.amount,
        },
        existing,
      });
    }

    return {
      statementId: statement.id,
      period: parsed.period,
      parserUsed: parsed.parserUsed,
      transactionsImported: inserted,
      pendingReview,
      transactions: categorizedTxs,
    };
  }

  /**
   * Resolve user decisions on cross-import duplicates surfaced by a prior
   * import. `keep` re-inserts the row from the staged data (caller supplies
   * the same {date, description, amount} that produced the hash); `skip`
   * is a no-op (the row stays unimported).
   *
   * Returns the count actually inserted plus the newly-categorized rows.
   */
  async resolveDuplicates(
    statementId: number,
    decisions: Array<{
      externalHash: string;
      action: 'keep' | 'skip';
      date: string;
      description: string;
      amount: number;
    }>,
  ): Promise<{ inserted: number; transactions: Transaction[] }> {
    const statement = await this.statementRepo.findById(statementId);
    if (!statement) throw new Error(`Statement ${statementId} not found`);

    const keeps = decisions.filter((d) => d.action === 'keep');
    if (keeps.length === 0) return { inserted: 0, transactions: [] };

    const rows = keeps.map((d) => ({
      accountId: statement.accountId,
      statementId,
      date: d.date,
      description: d.description,
      amount: d.amount,
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: null,
      ruleId: null,
      notes: null,
      taxDescription: null,
      externalHash: d.externalHash,
    }));

    const { inserted } = await this.txRepo.bulkCreate(
      rows as Parameters<typeof this.txRepo.bulkCreate>[0],
    );

    const newTxs = await this.txRepo.findAll({ statementId });
    await this.categorizationService.categorizeAll(newTxs);
    const categorized = await this.txRepo.findAll({ statementId });
    return { inserted, transactions: categorized };
  }
}
