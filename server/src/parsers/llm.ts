/**
 * LLM fallback parser.
 *
 * Uses an OpenAI-compatible API to extract transactions from raw PDF text.
 * Configure via env vars:
 *   LLM_API_KEY    — required
 *   LLM_BASE_URL   — defaults to OpenAI
 *   LLM_MODEL      — defaults to "gpt-4o-mini"
 */
import OpenAI from 'openai';
import { BankParser, ParsedStatement, ParsedTransaction } from './types';
import { inferPeriodFromTransactions } from './utils';

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
    // Always returns true — this is the fallback; the registry tries templates first.
    return true;
  }

  async parse(text: string): Promise<ParsedStatement> {
    const client = this.getClient();
    const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

    // Truncate to avoid token limits — keep first ~6000 chars which covers most statements
    const truncated = text.length > 24000 ? text.slice(0, 24000) + '\n[...truncated]' : text;

    // Anthropic's OpenAI-compatible endpoint rejects response_format: json_object.
    // Detect Anthropic by base URL and omit the field there; we rely on the prompt
    // (and a fallback JSON extractor below) to enforce JSON output.
    const isAnthropic = (process.env.LLM_BASE_URL ?? '').includes('anthropic');

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: truncated },
      ],
      temperature: 0,
      ...(isAnthropic ? {} : { response_format: { type: 'json_object' as const } }),
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    let parsed: { bankName?: string; period?: string; transactions?: ParsedTransaction[] };

    try {
      // Strip markdown code fences if present
      const jsonText = extractJson(content);
      parsed = JSON.parse(jsonText) as { bankName?: string; period?: string; transactions?: ParsedTransaction[] };
    } catch {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }

    const transactions = (parsed.transactions ?? []).map((t) => ({
      date: t.date,
      description: t.description,
      amount: Number(t.amount),
    }));

    const period = parsed.period ?? inferPeriodFromTransactions(transactions);
    const bankName = parsed.bankName ?? 'unknown';

    return { period, bankType: 'unknown', parserUsed: 'llm', bankName, transactions };
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
