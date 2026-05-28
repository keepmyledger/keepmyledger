/**
 * LLM fallback parser.
 *
 * Uses an OpenAI-compatible API to extract transactions from raw PDF text.
 * Configure via env vars:
 *   LLM_API_KEY:    required
 *   LLM_BASE_URL:   defaults to OpenAI
 *   LLM_MODEL:      defaults to "gpt-4o-mini"
 */
import OpenAI from 'openai';
import { AccountKind } from '@keepmyledger/shared';
import { BankParser, ParsedStatement, ParsedTransaction } from './types';
import { inferPeriodFromTransactions } from './utils';

/** Below this confidence after the first attempt, one clarifying retry is fired. */
const RETRY_CONFIDENCE_THRESHOLD = 0.5;

const SYSTEM_PROMPT = `You are a financial data extraction assistant.
Given raw text extracted from a bank statement PDF, extract all transactions and return them as JSON.

Return ONLY valid JSON matching this schema (no markdown, no extra text):
{
  "bankName": "Chase",
  "period": "YYYY-MM",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "merchant or description text",
      "amount": -123.45
    }
  ]
}

Rules:
- bankName is the name of the financial institution (e.g. "Chase", "Bank of America", "American Express"). Use "unknown" if you cannot determine it.
- amount is signed: negative for charges/debits/expenses, positive for payments/credits/income.
- date must be in ISO format YYYY-MM-DD.
- description should be clean merchant name or transaction description.
- period is the statement month, e.g. "2026-01".
- If you cannot determine the period from the text, infer it from the most common transaction month.
- Omit balance lines, opening/closing balance rows, interest summaries, and non-transaction lines.
`;

const COLUMN_STRUCTURE_PROMPT = `You are a financial PDF parser engineer.
Given raw text from a bank statement PDF, describe the column structure in enough detail
that a developer could write a deterministic text parser for it.

Return ONLY valid JSON matching this schema (no markdown, no extra text):
{
  "bankName": "Official institution name",
  "identifierPhrases": ["phrases that uniquely appear in this bank's PDF header/footer"],
  "layout": "brief description of layout (e.g. two-column debit/credit table, single signed-amount register)",
  "columns": [
    { "name": "date", "position": "left|center|right", "format": "e.g. MM/DD/YYYY" }
  ],
  "amountConvention": "e.g. positive=charge negative=payment",
  "sampleRows": ["2-3 raw text lines showing the transaction format"]
}
`;

export class LlmParser implements BankParser {
  name = 'LLM Fallback';
  bankType = 'unknown' as const;

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!process.env.LLM_API_KEY) {
      throw new Error(
        'LLM_API_KEY environment variable is not set. ' +
          'Cannot use LLM fallback parser. Set LLM_API_KEY (and optionally LLM_BASE_URL and LLM_MODEL).'
      );
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL, // undefined = OpenAI default
      });
    }
    return this.client;
  }

  canParse(_text: string): boolean {
    // Always returns true; this is the fallback (the registry tries templates first).
    return true;
  }

  async parse(text: string, accountKind?: AccountKind): Promise<ParsedStatement> {
    // Truncate to avoid token limits; keep first ~6000 chars which covers most statements
    const truncated = text.length > 24000 ? text.slice(0, 24000) + '\n[...truncated]' : text;

    const systemPrompt = SYSTEM_PROMPT + signConventionRule(accountKind);
    const first = await this.attempt(systemPrompt, truncated, accountKind);

    // Auto-retry once with a clarifying user message when confidence is low.
    if ((first.confidence ?? 0) < RETRY_CONFIDENCE_THRESHOLD && (first.warnings ?? []).length > 0) {
      const clarifier =
        `The previous parse had these issues: ${(first.warnings ?? []).join('; ')}. ` +
        `Please re-extract the transactions with these corrections in mind, ` +
        `and return ONLY the JSON object described in the system message.`;
      const second = await this.attempt(systemPrompt, `${truncated}\n\n${clarifier}`, accountKind);
      if ((second.confidence ?? 0) > (first.confidence ?? 0)) return second;
    }

    return first;
  }

  private async attempt(
    systemPrompt: string,
    userContent: string,
    accountKind: AccountKind | undefined,
  ): Promise<ParsedStatement> {
    const client = this.getClient();
    const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

    // Anthropic's OpenAI-compatible endpoint rejects response_format: json_object.
    // Detect Anthropic by base URL and omit the field there; we rely on the prompt
    // (and a fallback JSON extractor below) to enforce JSON output.
    const isAnthropic = (process.env.LLM_BASE_URL ?? '').includes('anthropic');

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      ...(isAnthropic ? {} : { response_format: { type: 'json_object' as const } }),
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    let parsed: { bankName?: string; period?: string; transactions?: unknown };

    try {
      const jsonText = extractJson(content);
      parsed = JSON.parse(jsonText) as { bankName?: string; period?: string; transactions?: unknown };
    } catch {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }

    // Defensive validator: explicitly whitelist the keys we accept. Drops any
    // unexpected fields (e.g. hallucinated `categoryId`) so they can't reach
    // the DB.
    const rawTxs = Array.isArray(parsed.transactions) ? (parsed.transactions as unknown[]) : [];
    const transactions: ParsedTransaction[] = rawTxs.map((raw) => {
      const t = raw as Record<string, unknown>;
      return {
        date: String(t.date ?? ''),
        description: String(t.description ?? ''),
        amount: Number(t.amount),
      };
    });

    const period = parsed.period ?? inferPeriodFromTransactions(transactions);
    const bankName = parsed.bankName ?? 'unknown';

    const { confidence, warnings } = scoreLlmResult(transactions, period, bankName, accountKind);

    return { period, bankType: 'unknown', parserUsed: 'llm', bankName, transactions, confidence, warnings };
  }

  /**
   * Makes a second LLM call to describe the column/layout structure of the
   * PDF text. Called once per bank after the hit threshold is crossed.
   * The result is stored in llm_bank_hints.column_hint for developer reference.
   */
  async describeColumnStructure(text: string, bankName: string): Promise<string> {
    const client = this.getClient();
    const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
    const truncated = text.length > 16000 ? text.slice(0, 16000) + '\n[...truncated]' : text;
    const isAnthropic = (process.env.LLM_BASE_URL ?? '').includes('anthropic');

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: COLUMN_STRUCTURE_PROMPT },
        { role: 'user', content: `Bank: ${bankName}\n\n${truncated}` },
      ],
      temperature: 0,
      ...(isAnthropic ? {} : { response_format: { type: 'json_object' as const } }),
      max_tokens: 1024,
    });

    return response.choices[0]?.message?.content ?? '{}';
  }
}

export const llmParser = new LlmParser();

/**
 * Score the LLM parser's output and surface warnings for the user to spot-check.
 * Confidence starts at 1.0 and decays by a penalty per category of concern;
 * warnings are short human-readable strings shown on the import preview.
 */
function scoreLlmResult(
  transactions: ParsedTransaction[],
  period: string,
  bankName: string,
  accountKind?: AccountKind,
): { confidence: number; warnings: string[] } {
  const warnings: string[] = [];
  let confidence = 1.0;

  if (transactions.length === 0) {
    return { confidence: 0, warnings: ['No transactions were extracted from this statement.'] };
  }

  const badDateCount = transactions.filter((t) => !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date))).length;
  if (badDateCount > 0) {
    const pct = Math.round((badDateCount / transactions.length) * 100);
    warnings.push(`${badDateCount} of ${transactions.length} transactions have unparseable dates (${pct}%).`);
    confidence -= Math.min(0.4, (badDateCount / transactions.length) * 0.8);
  }

  const badAmountCount = transactions.filter((t) => !Number.isFinite(t.amount)).length;
  if (badAmountCount > 0) {
    warnings.push(`${badAmountCount} of ${transactions.length} transactions have invalid amounts.`);
    confidence -= Math.min(0.4, (badAmountCount / transactions.length) * 0.8);
  }

  // Period mismatch: many transactions outside the stated month suggest a parse error.
  if (/^\d{4}-\d{2}$/.test(period)) {
    const inPeriod = transactions.filter((t) => t.date.startsWith(period)).length;
    const outRatio = 1 - inPeriod / transactions.length;
    if (outRatio > 0.5) {
      warnings.push(`Most transactions are outside the detected period (${period}). Double-check the statement month.`);
      confidence -= 0.2;
    }
  }

  // Exact duplicates are unusual on a single statement; flag if > 10% of rows are duplicates.
  const seen = new Set<string>();
  let duplicates = 0;
  for (const t of transactions) {
    const key = `${t.date}|${t.amount}|${t.description}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  if (duplicates > 0 && duplicates / transactions.length > 0.1) {
    warnings.push(`${duplicates} duplicate transactions detected. Review before importing.`);
    confidence -= 0.15;
  }

  if (bankName === 'unknown') {
    warnings.push('Could not identify the financial institution. Verify the transactions match your statement.');
    confidence -= 0.1;
  }

  // Sign-convention sanity check by accountKind.
  // For credit cards we expect mostly charges (negative). For checking/savings
  // we expect mostly expenses (negative) plus periodic deposits. If the LLM
  // returns the opposite distribution it likely got the convention backwards.
  if (accountKind) {
    const positives = transactions.filter((t) => Number.isFinite(t.amount) && t.amount > 0).length;
    const positiveRatio = positives / transactions.length;
    if (accountKind === 'credit_card' && positiveRatio > 0.7) {
      warnings.push(
        'Expected most credit-card transactions to be charges (negative); got mostly positives — sign convention may be reversed.',
      );
      confidence -= 0.2;
    }
  }

  return { confidence: Math.max(0, Math.min(1, confidence)), warnings };
}

/**
 * Returns an instruction snippet to append to the system prompt that pins down
 * the sign convention for the account being parsed. Empty string when no
 * account context is available.
 */
function signConventionRule(accountKind: AccountKind | undefined): string {
  if (accountKind === 'credit_card') {
    return (
      '\nThis is a credit card statement: charges and purchases must be NEGATIVE amounts; ' +
      'payments to the card and credits must be POSITIVE amounts.'
    );
  }
  if (accountKind === 'checking' || accountKind === 'savings') {
    return (
      '\nThis is a bank account statement: withdrawals and expenses must be NEGATIVE amounts; ' +
      'deposits and income must be POSITIVE amounts.'
    );
  }
  return '';
}

/** Extract JSON from a potentially-fenced or noisy LLM response. */
function extractJson(content: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Otherwise, slice from first { to last }
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return content.slice(start, end + 1);

  return content;
}
