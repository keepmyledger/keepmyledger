/**
 * Chase credit card statement parser.
 *
 * Strategy: Chase statements list one transaction per line in the form
 *   MM/DD  MERCHANT NAME OR DESCRIPTION  amount
 *
 * Sign on the amount already encodes direction: payments/credits use a
 * negative sign ("-40.00") and purchases are positive ("123.45"). Year is
 * not present on the row but the statement's Opening/Closing Date provides
 * the billing period; we use the closing year for dates ≤ closing month and
 * subtract one year for the preceding December rows.
 */
import { BankParser, ParsedStatement, ParsedTransaction } from './types';
import { PositionedLine } from './pdfPositional';
import { inferPeriodFromTransactions } from './utils';

const DATE_RE = /^(\d{2})\/(\d{2})$/;
const AMOUNT_RE = /^-?[\d,]+\.\d{2}$/;
// "Opening/Closing Date 12/09/25 - 01/08/26"
const PERIOD_RE = /Opening\/Closing Date[\s\S]{0,40}?\d{2}\/\d{2}\/(\d{2})\s*-\s*(\d{2})\/\d{2}\/(\d{2})/i;

export const chaseParser: BankParser = {
  name: 'Chase',
  bankType: 'chase',

  canParse(text: string): boolean {
    return /chase\.com|JPMorgan Chase|Chase Mobile/i.test(text);
  },

  parse(_text: string): ParsedStatement {
    return { period: '', bankType: 'chase', parserUsed: 'template', transactions: [] };
  },

  parsePositional(lines: PositionedLine[], text: string): ParsedStatement {
    // Derive closing month/year from header for date assignment
    const pm = text.match(PERIOD_RE);
    const closingMonth = pm ? parseInt(pm[2], 10) : 0;
    const closingYear = pm ? 2000 + parseInt(pm[3], 10) : new Date().getFullYear();
    const openingYear = pm ? 2000 + parseInt(pm[1], 10) : closingYear;

    const transactions: ParsedTransaction[] = [];

    for (const line of lines) {
      const first = line.items[0];
      if (!first) continue;
      const dm = first.text.match(DATE_RE);
      if (!dm) continue;

      const last = line.items[line.items.length - 1];
      if (!last || !AMOUNT_RE.test(last.text)) continue;

      const [, mm, dd] = dm;
      const monthNum = parseInt(mm, 10);
      // If the row's month is greater than the closing month, it must belong
      // to the prior year (typical Dec/Jan crossover statements).
      const year = monthNum > closingMonth ? openingYear : closingYear;
      const date = `${year}-${mm}-${dd}`;

      const amount = parseAmount(last.text);
      const middle = line.items.slice(1, -1).map((i) => i.text);
      const description = middle.join(' ').replace(/\s+/g, ' ').trim();
      if (!description) continue;

      transactions.push({ date, description, amount });
    }

    const period = pm
      ? `${closingYear}-${String(closingMonth).padStart(2, '0')}`
      : inferPeriodFromTransactions(transactions);

    return { period, bankType: 'chase', parserUsed: 'template', transactions };
  },
};

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
