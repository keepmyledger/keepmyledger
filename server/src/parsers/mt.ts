/**
 * M&T Bank statement parser.
 *
 * Strategy: M&T statements lay out transactions in fixed columns
 *   POSTING DATE | TRANSACTION DESCRIPTION | DEPOSITS & OTHER CREDITS (+) |
 *   WITHDRAWALS & OTHER DEBITS (-) | DAILY BALANCE
 *
 * Text-only extraction loses column boundaries so amount sign becomes
 * ambiguous. The positional parser reads x-coordinates from pdfjs and uses
 * the header row to learn each column's x-range, then assigns sign based on
 * which column an amount lives in.
 */
import { BankParser, ParsedStatement, ParsedTransaction } from './types';
import { PositionedLine, PositionedText } from './pdfPositional';
import { inferPeriodFromTransactions } from './utils';

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const AMOUNT_RE = /^\$?-?[\d,]+\.\d{2}$/;
const PERIOD_RE = /(\d{2}\/\d{2}\/\d{2})\s*-\s*(\d{2}\/\d{2}\/\d{2})/;

export const mtParser: BankParser = {
  name: 'M&T Bank',
  bankType: 'mt',

  canParse(text: string): boolean {
    return /M&T|MTBMRCH|Manufacturers and Traders/i.test(text);
  },

  parse(_text: string): ParsedStatement {
    // Text-only fallback isn't reliable for M&T; signal empty so the LLM is used.
    return { period: '', bankType: 'mt', parserUsed: 'template', transactions: [] };
  },

  parsePositional(lines: PositionedLine[], text: string): ParsedStatement {
    const cols = findColumns(lines);
    if (!cols) {
      return { period: '', bankType: 'mt', parserUsed: 'template', transactions: [] };
    }

    const transactions: ParsedTransaction[] = [];
    for (const line of lines) {
      const first = line.items[0];
      if (!first) continue;
      const dm = first.text.match(DATE_RE);
      if (!dm) continue;

      const [, mm, dd, yyyy] = dm;
      const date = `${yyyy}-${mm}-${dd}`;

      // Skip the BEGINNING / ENDING BALANCE rows
      const restText = line.items
        .slice(1)
        .map((i) => i.text)
        .join(' ');
      if (/BEGINNING BALANCE|ENDING BALANCE/i.test(restText)) continue;

      // Collect amounts and classify by column
      let deposit: number | null = null;
      let withdrawal: number | null = null;
      const descParts: string[] = [];

      for (const item of line.items.slice(1)) {
        if (AMOUNT_RE.test(item.text)) {
          const value = parseAmount(item.text);
          if (item.x >= cols.balance - 5) {
            // balance column — ignore
          } else if (item.x >= cols.withdrawals - 5) {
            withdrawal = value;
          } else if (item.x >= cols.deposits - 5) {
            deposit = value;
          } else {
            // amount fragment inside description (e.g. account #) — keep as text
            descParts.push(item.text);
          }
        } else {
          descParts.push(item.text);
        }
      }

      if (deposit === null && withdrawal === null) continue;
      const amount = deposit !== null ? deposit : -(withdrawal as number);
      const description = descParts.join(' ').replace(/\s+/g, ' ').trim();
      transactions.push({ date, description, amount });
    }

    // Derive period from "STATEMENT PERIOD MM/DD/YY - MM/DD/YY" header (text-based is fine)
    const periodMatch = text.match(PERIOD_RE);
    let period: string;
    if (periodMatch) {
      const [, start] = periodMatch;
      const [mm, , yy] = start.split('/');
      period = `20${yy}-${mm}`;
    } else {
      period = inferPeriodFromTransactions(transactions);
    }

    return { period, bankType: 'mt', parserUsed: 'template', transactions };
  },
};

interface MtColumns {
  /** Left edge x of DEPOSITS & OTHER CREDITS column */
  deposits: number;
  /** Left edge x of WITHDRAWALS & OTHER DEBITS column */
  withdrawals: number;
  /** Left edge x of DAILY BALANCE column */
  balance: number;
}

function findColumns(lines: PositionedLine[]): MtColumns | null {
  // Header row contains "DEPOSITS & OTHER", "WITHDRAWALS &", and "DAILY" (or "BALANCE")
  for (const line of lines) {
    const findX = (needle: RegExp): PositionedText | undefined =>
      line.items.find((i) => needle.test(i.text));
    const dep = findX(/^DEPOSITS\b/i);
    const wd = findX(/^WITHDRAWALS\b/i);
    const bal = findX(/^DAILY\b|^BALANCE\b/i);
    if (dep && wd && bal) {
      return { deposits: dep.x, withdrawals: wd.x, balance: bal.x };
    }
  }
  return null;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
