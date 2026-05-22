import { BankType } from '@keepmyledger/shared';
import { ParsedTransaction } from './types';

/**
 * Normalize a raw amount string from a bank statement into a signed number.
 * Convention: expenses/debits → negative, income/credits → positive.
 *
 * Most bank statements use parentheses for negative amounts or an explicit "-".
 * Credit card statements often list charges as positive and payments as negative
 * (the opposite of checking). The `bankType` lets us flip the sign when needed.
 */
export function normalizeAmount(raw: string, bankType: BankType): number {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const isParenNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numStr = cleaned.replace(/[()]/g, '');
  const value = parseFloat(numStr);

  const signed = isParenNegative || cleaned.startsWith('-') ? -Math.abs(value) : Math.abs(value);

  // Credit card statements: positive amounts are charges (expenses → negative)
  // Checking/savings:        positive amounts are credits (income → positive)
  // We keep the sign from the statement as-is here; the caller can flip if needed
  // based on account_kind at import time.
  return signed;
}

/**
 * Given a list of parsed transactions, infer the statement period as YYYY-MM
 * by taking the most common month among transactions.
 */
export function inferPeriodFromTransactions(transactions: ParsedTransaction[]): string {
  if (transactions.length === 0) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const counts: Record<string, number> = {};
  for (const tx of transactions) {
    const period = tx.date.slice(0, 7); // YYYY-MM
    counts[period] = (counts[period] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Generate a deterministic hash for a transaction to enable deduplication.
 * Uses: accountId + date + normalized description + amount.
 */
export function hashTransaction(
  accountId: number,
  date: string,
  description: string,
  amount: number
): string {
  const normalizedDesc = description.toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = `${accountId}|${date}|${normalizedDesc}|${amount.toFixed(2)}`;
  // Simple djb2 hash — good enough for local deduplication (not cryptographic)
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) ^ raw.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return `${h.toString(16)}-${raw.length}`;
}
