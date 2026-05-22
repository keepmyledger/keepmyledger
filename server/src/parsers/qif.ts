/**
 * QIF (Quicken Interchange Format) parser.
 *
 * Handles the most common QIF structures exported by US banks and personal
 * finance apps:
 *
 *   !Type:Bank  — checking / savings
 *   !Type:CCard — credit card
 *   !Type:Oth L — other / liability (treated as bank)
 *   !Type:Cash  — cash accounts (treated as bank)
 *
 * Per-transaction fields used:
 *   D  Date
 *   T  Amount  (negative = debit for Bank; positive = charge for CCard)
 *   P  Payee / description
 *   M  Memo   (appended to description when present and different)
 *   ^  End-of-record marker
 *
 * Sign convention on output: negative = expense/money-out, positive = income.
 * For CCard entries the amount is negated (a charge of +50 becomes -50).
 */
import { ParsedStatement, ParsedTransaction } from './types';
import { inferPeriodFromTransactions } from './utils';

export type QifAccountType = 'bank' | 'ccard' | 'other';

export interface ParseQifResult extends ParsedStatement {
  /** QIF account type detected from !Type header */
  qifAccountType: QifAccountType;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseQif(rawText: string): ParseQifResult {
  const text = stripBom(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  let accountType: QifAccountType = 'bank';
  const transactions: ParsedTransaction[] = [];

  // Working record
  let date: string | null = null;
  let amount: number | null = null;
  let payee: string | null = null;
  let memo: string | null = null;
  let inRecord = false;

  const commitRecord = () => {
    if (!inRecord) return;
    if (date && amount !== null) {
      // Build description: payee, optionally appended with memo if distinct.
      let description = payee?.trim() ?? '';
      const memoClean = memo?.trim() ?? '';
      if (memoClean && memoClean.toLowerCase() !== description.toLowerCase()) {
        description = description ? `${description} – ${memoClean}` : memoClean;
      }
      if (!description) description = '(no description)';

      // CCard: Quicken/QIF convention is positive = charge (expense).
      // Flip to storage convention (negative = expense).
      const finalAmount = accountType === 'ccard' ? -amount : amount;

      transactions.push({ date, description, amount: finalAmount });
    }
    // reset
    date = null;
    amount = null;
    payee = null;
    memo = null;
    inRecord = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const code = line[0].toUpperCase();
    const value = line.slice(1).trim();

    if (code === '!') {
      // Type header — commit any open record first
      commitRecord();
      accountType = detectAccountType(value);
      continue;
    }

    if (code === '^') {
      commitRecord();
      continue;
    }

    // Inside a record
    inRecord = true;
    switch (code) {
      case 'D': {
        const d = parseQifDate(value);
        if (d) date = d;
        break;
      }
      case 'T':
      case 'U': // U is a duplicate of T in some exporters, same value
        amount = parseAmount(value);
        break;
      case 'P':
        payee = value;
        break;
      case 'M':
        memo = value;
        break;
      // N (check number), C (cleared), L (category), $ (split) — ignored
    }
  }

  // Flush last record in case file has no trailing ^
  commitRecord();

  if (transactions.length === 0) {
    throw new Error('No transactions found in QIF file');
  }

  const period = inferPeriodFromTransactions(transactions);

  return {
    period,
    bankType: 'unknown',
    parserUsed: 'qif',
    transactions,
    qifAccountType: accountType,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectAccountType(typeHeader: string): QifAccountType {
  const v = typeHeader.toLowerCase();
  if (v.startsWith('type:ccard') || v.startsWith('ccard')) return 'ccard';
  if (v.startsWith('type:bank') || v.startsWith('bank')) return 'bank';
  if (v.startsWith('type:cash') || v.startsWith('cash')) return 'bank';
  return 'other';
}

/**
 * Parse QIF date strings.
 * Common formats:
 *   M/D/YYYY   MM/DD/YYYY   M/D/YY   M- D-YY  (Quicken uses M- D'-YY)
 *   YYYY-MM-DD  YYYY/MM/DD
 *   D/M/YYYY   DD-MMM-YYYY  (European)
 */
export function parseQifDate(s: string): string | null {
  // Normalize Quicken's odd M- D'-YY format (e.g. "1- 5'26" → "1/5/2026")
  s = s.replace(/(\d+)-\s*(\d+)'(\d+)/, '$1/$2/$3').trim();

  // ISO-like: YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // US-style: M/D/YYYY, M/D/YY, MM-DD-YYYY
  const us = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return formatDate(year, Number(us[1]), Number(us[2]));
  }

  // D-MMM-YYYY or D MMM YYYY
  const dmy = s.match(/^(\d{1,2})[- ]([a-zA-Z]+)[- ](\d{2,4})$/);
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase().slice(0, 3)];
    if (month) {
      let year = Number(dmy[3]);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      return formatDate(year, month, Number(dmy[1]));
    }
  }

  return null;
}

function formatDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a QIF amount string.
 * Examples: "-1,234.56"  "1234.56"  "-1.234,56" (European)  "(500.00)"
 */
export function parseQifAmount(s: string): number | null {
  return parseAmount(s);
}

function parseAmount(s: string): number | null {
  let v = s.trim();
  const negative = v.startsWith('-') || (v.startsWith('(') && v.endsWith(')'));
  v = v.replace(/[()]/g, '').replace(/^-/, '').trim();

  // European decimal: last separator is a comma with >0 digits after
  const euroMatch = v.match(/,(\d{1,2})$/);
  if (euroMatch) {
    v = v.replace(/\./g, '').replace(',', '.');
  } else {
    v = v.replace(/,/g, '');
  }

  const n = parseFloat(v);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}
