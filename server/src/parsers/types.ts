import { BankType } from '@keepmyledger/shared';
import { PositionedLine } from './pdfPositional';

export interface ParsedTransaction {
  date: string;       // YYYY-MM-DD
  description: string;
  amount: number;     // signed: negative=debit/expense, positive=credit/income
}

export interface ParsedStatement {
  period: string;       // YYYY-MM
  bankType: BankType;
  parserUsed: 'template' | 'llm' | 'csv' | 'qif' | 'ofx' | 'generic';
  transactions: ParsedTransaction[];
  /** LLM-identified institution name (only set when parserUsed === 'llm'). */
  bankName?: string;
  /** CSV-only: the column mapping that produced these transactions. */
  detectedMapping?: { date: number; description: number; amount?: number; debit?: number; credit?: number };
  /** CSV-only: the delimiter character that was detected. */
  delimiter?: string;
  /** 0..1 self-rated confidence. Omitted when the parser cannot estimate. */
  confidence?: number;
  /** Human-readable concerns surfaced to the user on the import preview. */
  warnings?: string[];
}

export interface BankParser {
  /** Human-readable name for this parser */
  name: string;
  bankType: BankType;
  /** Returns true if this parser recognizes the text as its bank's format */
  canParse(text: string): boolean;
  /** Extract period + transactions from raw PDF text */
  parse(text: string): ParsedStatement | Promise<ParsedStatement>;
  /**
   * Optional column-aware parser using positional text fragments. Preferred
   * over `parse()` when positional data is available. Returns null/throws to
   * signal the caller should fall back to text-based parsing.
   */
  parsePositional?(
    lines: PositionedLine[],
    text: string
  ): ParsedStatement | Promise<ParsedStatement>;
}
