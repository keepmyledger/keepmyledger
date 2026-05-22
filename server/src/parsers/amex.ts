/**
 * American Express statement parser.
 *
 * Strategy: Amex statements lay out one transaction per line as
 *   MM/DD/YY[*]  MERCHANT NAME ...  [CITY  STATE]  [-]$amount
 *
 * Continuation lines below (phone, category, etc.) lack a leading date and
 * are ignored. Sign is already encoded on the amount: payments/credits use
 * "-$x.xx" and new charges use "$x.xx".
 *
 * We use positional data only to detect the line boundaries and the
 * rightmost amount, but column x-ranges aren't strictly necessary here.
 */
import { BankParser, ParsedStatement, ParsedTransaction } from './types';
import { PositionedLine } from './pdfPositional';
import { inferPeriodFromTransactions } from './utils';

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{2})\*?$/;
const AMOUNT_RE = /^-?\$[\d,]+\.\d{2}$/;
const PERIOD_RE = /Closing Date\s+(\d{2})\/\d{2}\/(\d{2})/i;

export const amexParser: BankParser = {
  name: 'American Express',
  bankType: 'amex',

  canParse(text: string): boolean {
    return /American Express/i.test(text);
  },

  parse(_text: string): ParsedStatement {
    // Text-only fallback isn't reliable for Amex; signal empty so caller falls through.
    return { period: '', bankType: 'amex', parserUsed: 'template', transactions: [] };
  },

  parsePositional(lines: PositionedLine[], text: string): ParsedStatement {
    const transactions: ParsedTransaction[] = [];

    for (const line of lines) {
      const first = line.items[0];
      if (!first) continue;
      const dm = first.text.match(DATE_RE);
      if (!dm) continue;

      // Last item is the amount (signed).
      const last = line.items[line.items.length - 1];
      if (!last || !AMOUNT_RE.test(last.text)) continue;

      const [, mm, dd, yy] = dm;
      const date = `20${yy}-${mm}-${dd}`;
      const amount = parseAmount(last.text);

      // Description = everything between date and amount. Drop trailing 2-letter
      // state codes (e.g. "MD", "CT") that always appear immediately before the
      // amount, and the city before that is also noisy but harmless — keep it.
      const middle = line.items.slice(1, -1).map((i) => i.text);
      const description = middle.join(' ').replace(/\s+/g, ' ').trim();
      if (!description) continue;

      transactions.push({ date, description, amount });
    }

    // Period from "Closing Date MM/DD/YY"
    const pm = text.match(PERIOD_RE);
    const period = pm
      ? `20${pm[2]}-${pm[1]}`
      : inferPeriodFromTransactions(transactions);

    return { period, bankType: 'amex', parserUsed: 'template', transactions };
  },
};

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
