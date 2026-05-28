import { BankType, AccountKind } from '@keepmyledger/shared';
import { BankParser, ParsedStatement } from './types';
import { PositionedLine } from './pdfPositional';
import { mtParser } from './mt';
import { amexParser } from './amex';
import { chaseParser } from './chase';
import { llmParser } from './llm';
import { parseGeneric } from './generic';

/** Template parsers tried in order before generic/LLM fallback */
const TEMPLATE_PARSERS: BankParser[] = [mtParser, amexParser, chaseParser];

/**
 * Find the template parser that matches the given text, or null.
 */
export function findTemplateParser(text: string): BankParser | null {
  return TEMPLATE_PARSERS.find((p) => p.canParse(text)) ?? null;
}

/**
 * Parse a bank statement PDF using template parsers, then a generic heuristic
 * extractor. Never calls the LLM — that requires explicit user consent via
 * parseStatementWithLlm().
 */
export async function parseStatement(
  text: string,
  options?: {
    /** Hint: skip template matching for this bank type */
    preferredBankType?: BankType;
    /** Positional text fragments grouped into lines (required for generic fallback) */
    positional?: PositionedLine[];
  }
): Promise<ParsedStatement> {
  const templateParser = findTemplateParser(text);
  if (templateParser) {
    try {
      if (templateParser.parsePositional && options?.positional) {
        const positionalResult = await Promise.resolve(
          templateParser.parsePositional(options.positional, text)
        );
        if (positionalResult.transactions.length > 0) return positionalResult;
        console.warn(`[parser] "${templateParser.name}" positional parse returned 0 txs, trying text parser`);
      }
      const result = (templateParser as unknown as { parse(t: string): ParsedStatement | Promise<ParsedStatement> }).parse(text);
      const resolved = result instanceof Promise ? await result : result;
      if (resolved.transactions.length > 0) return resolved;
      console.warn(`[parser] "${templateParser.name}" text parse returned 0 txs, falling back to generic`);
    } catch (err) {
      console.warn(`[parser] Template parser "${templateParser.name}" failed, falling back to generic:`, err);
    }
  }

  // Generic heuristic extractor — no external calls.
  // Returns low-confidence results; caller should surface the LLM opt-in.
  if (options?.positional) {
    return parseGeneric(options.positional);
  }

  // No positional data: return an empty generic result so the caller can still
  // show the LLM opt-in without crashing.
  return {
    period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    bankType: 'unknown',
    parserUsed: 'generic',
    transactions: [],
    confidence: 0,
    warnings: [
      'Could not extract positional data from this PDF.',
      'No transactions were found automatically.',
    ],
  };
}

/**
 * Parse a bank statement using the LLM. Only call this after the user has
 * explicitly consented to send their statement data to the configured LLM
 * provider. Throws if LLM_API_KEY is not set.
 */
export async function parseStatementWithLlm(text: string, accountKind?: AccountKind): Promise<ParsedStatement> {
  return llmParser.parse(text, accountKind);
}

export { BankParser, ParsedStatement } from './types';
export { TEMPLATE_PARSERS };
export { llmParser };
