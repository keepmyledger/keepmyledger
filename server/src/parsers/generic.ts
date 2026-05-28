/**
 * Generic heuristic PDF parser.
 *
 * Used when no bank template matches. Scans positional lines for date + amount
 * patterns and assembles candidate transaction rows without sending any data
 * to an external service. Confidence is always low; the preview UI should
 * surface warnings and offer the LLM opt-in as a next step.
 *
 * Sign convention: amounts are extracted exactly as they appear in the PDF.
 * Parenthetical or "-"-prefixed values become negative; bare positives stay
 * positive. On unknown PDFs we cannot distinguish debit from credit columns
 * reliably, so the user must verify signs before committing.
 */

import { ParsedStatement, ParsedTransaction } from './types';
import { PositionedLine } from './pdfPositional';
import { inferPeriodFromTransactions } from './utils';

// ── Date extraction ──────────────────────────────────────────────────────────

const MONTH_IDX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDate(text: string): string | null {
  // ISO: 2024-01-15
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // MM/DD/YYYY or M/D/YYYY
  const mdy4 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (mdy4) return fmt(mdy4[3], mdy4[1], mdy4[2]);

  // MM/DD/YY
  const mdy2 = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
  if (mdy2) {
    const year = Number(mdy2[3]) < 50 ? `20${mdy2[3]}` : `19${mdy2[3]}`;
    return fmt(year, mdy2[1], mdy2[2]);
  }

  // Month name: Jan 15 2024, January 15, Jan. 15
  const mon = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:[, ]+(\d{4}))?\b/i,
  );
  if (mon) {
    const mIdx = MONTH_IDX[mon[1].toLowerCase().slice(0, 3)];
    if (mIdx) {
      const year = mon[3] ?? String(new Date().getFullYear());
      return fmt(year, String(mIdx), mon[2]);
    }
  }

  // MM/DD only — infer year from surrounding transactions later
  const md = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) return fmt(String(new Date().getFullYear()), md[1], md[2]);

  return null;
}

function fmt(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ── Amount extraction ────────────────────────────────────────────────────────

function parseAmount(text: string): number | null {
  // Parenthetical negative: (1,234.56)
  const parens = text.match(/^\(?([\d,]+\.\d{2})\)?$/);
  if (parens && text.startsWith('(')) return -parseFloat(parens[1].replace(/,/g, ''));

  // Explicit minus: -1,234.56 or -$1,234.56
  const neg = text.match(/^-\$?([\d,]+\.\d{2})$/);
  if (neg) return -parseFloat(neg[1].replace(/,/g, ''));

  // Plain positive: 1,234.56 or $1,234.56
  const pos = text.match(/^\$?([\d,]+\.\d{2})$/);
  if (pos) return parseFloat(pos[1].replace(/,/g, ''));

  return null;
}

// A fragment "looks like" an amount (used after splitting a line by spaces)
function looksLikeAmount(s: string): boolean {
  return /^\(?\$?[\d,]+\.\d{2}\)?$/.test(s.trim());
}

// A fragment "looks like" a date token
function looksLikeDate(s: string): boolean {
  return (
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(s) ||
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?$/i.test(s)
  );
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseGeneric(lines: PositionedLine[]): ParsedStatement {
  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    const fullText = line.items.map((i) => i.text).join(' ').trim();

    // Skip very short lines (page numbers, column headers, etc.)
    if (fullText.length < 6) continue;

    // Try to find a date in the full line text
    const date = parseDate(fullText);
    if (!date) continue;

    // Collect amount candidates from individual fragments
    const amountFragments: { value: number; x: number }[] = [];
    for (const item of line.items) {
      const v = parseAmount(item.text.trim());
      if (v !== null) amountFragments.push({ value: v, x: item.x });
    }

    if (amountFragments.length === 0) continue;

    // Build description from non-date, non-amount fragments
    const descParts: string[] = [];
    for (const item of line.items) {
      const t = item.text.trim();
      if (!t) continue;
      if (looksLikeAmount(t)) continue;
      if (looksLikeDate(t)) continue;
      // Skip bare integers (often balance amounts or page refs)
      if (/^\d+$/.test(t)) continue;
      descParts.push(t);
    }
    const description = descParts.join(' ').trim() || 'Unknown';

    // Determine amount:
    // - Single amount: use as-is
    // - Two amounts: common in two-column (debit left / credit right) layouts.
    //   Treat leftmost as expense (negative), rightmost as income (positive).
    //   If one is zero, use the non-zero one.
    // - More than two: skip — likely a summary or running-balance row
    if (amountFragments.length > 2) continue;

    let amount: number;
    if (amountFragments.length === 1) {
      amount = amountFragments[0].value;
    } else {
      const [left, right] = amountFragments.sort((a, b) => a.x - b.x);
      if (Math.abs(left.value) < 0.001) {
        amount = right.value; // right column (credit/income)
      } else if (Math.abs(right.value) < 0.001) {
        amount = -Math.abs(left.value); // left column (debit/expense) → negative
      } else {
        // Both populated — net them and note uncertainty
        amount = right.value - Math.abs(left.value);
      }
    }

    // Basic date sanity: reject obviously invalid months/days
    const [, mm, dd] = (date.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? []);
    if (Number(mm) > 12 || Number(dd) > 31) continue;

    transactions.push({ date, description, amount });
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = transactions.filter((t) => {
    const key = `${t.date}|${t.amount}|${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const period = inferPeriodFromTransactions(deduped);

  const warnings: string[] = [
    'Parsed using our built-in heuristic extractor — no data was sent externally.',
    'Please verify all transactions, especially amounts and signs (+ / −), before confirming.',
  ];
  if (deduped.length === 0) {
    warnings.unshift('No transactions could be extracted automatically from this statement.');
  }

  return {
    period,
    bankType: 'unknown',
    parserUsed: 'generic',
    transactions: deduped,
    confidence: deduped.length === 0 ? 0 : 0.45,
    warnings,
  };
}
