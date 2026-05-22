import { BankType } from '@keepmyledger/shared';
import { BankParser, ParsedStatement } from './types';
import { PositionedLine } from './pdfPositional';
import { mtParser } from './mt';
import { amexParser } from './amex';
import { chaseParser } from './chase';
import { llmParser } from './llm';

/** Template parsers tried in order before LLM fallback */
const TEMPLATE_PARSERS: BankParser[] = [mtParser, amexParser, chaseParser];

/**
 * Find the template parser that matches the given text, or null.
 */
export function findTemplateParser(text: string): BankParser | null {
  return TEMPLATE_PARSERS.find((p) => p.canParse(text)) ?? null;
}

/**
 * Parse a bank statement PDF text using the best available parser.
 * Strategy: try matching template parsers first; fall back to LLM if none match
 * or if `forceLlm` is true.
 */
export async function parseStatement(
  text: string,
  options?: {
    /** Force LLM even if a template matches */
    forceLlm?: boolean;
    /** Hint: skip template matching for this bank type and go to LLM */
    preferredBankType?: BankType;
    /** Positional text fragments grouped into lines (preferred when available) */
    positional?: PositionedLine[];
  }
): Promise<ParsedStatement> {
  const forceLlm = options?.forceLlm ?? false;

  if (!forceLlm) {
    const templateParser = findTemplateParser(text);
    if (templateParser) {
      try {
        // Prefer column-aware positional parsing when both are available
        if (templateParser.parsePositional && options?.positional) {
          const positionalResult = await Promise.resolve(
            templateParser.parsePositional(options.positional, text)
          );
          if (positionalResult.transactions.length > 0) {
            return positionalResult;
          }
          console.warn(
            `[parser] "${templateParser.name}" positional parse returned 0 txs, trying text parser`
          );
        }
        const result = (templateParser as unknown as { parse(t: string): ParsedStatement | Promise<ParsedStatement> }).parse(text);
        const resolved = result instanceof Promise ? await result : result;
        if (resolved.transactions.length > 0) return resolved;
        console.warn(
          `[parser] "${templateParser.name}" text parse returned 0 txs, falling back to LLM`
        );
      } catch (err) {
        console.warn(
          `[parser] Template parser "${templateParser.name}" failed, falling back to LLM:`,
          err
        );
      }
    }
  }

  // LLM fallback — will throw if LLM_API_KEY not set
  return llmParser.parse(text);
}

export { BankParser, ParsedStatement } from './types';
export { TEMPLATE_PARSERS };
