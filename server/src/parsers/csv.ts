/**
 * Generic CSV bank-export parser.
 *
 * Handles the common shapes banks export to CSV:
 *   - Single signed `amount` column (negative = debit).
 *   - Split `debit` / `credit` columns (amount = credit - debit).
 *   - Quoted descriptions containing the delimiter.
 *   - Comma, semicolon, or tab delimiters.
 *   - BOM-prefixed files, mixed line endings.
 *
 * Sign convention on output matches storage convention everywhere else in
 * the app: negative = money out, positive = money in. We do NOT flip signs
 * for credit-card accounts because banks export CSV in storage convention
 * already (unlike PDFs which print charges as positive).
 */
import { ParsedStatement, ParsedTransaction } from './types';
import { inferPeriodFromTransactions } from './utils';

export interface ParseCsvOptions {
  /** Optional explicit column mapping; overrides header sniffing. */
  mapping?: ColumnMapping;
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** Index of the signed amount column, OR -1 if using debit/credit split. */
  amount?: number;
  debit?: number;
  credit?: number;
}

const DATE_SYNONYMS = [
  'date', 'posted date', 'posting date', 'post date', 'transaction date',
  'trans date', 'posted', 'date posted',
];
const DESC_SYNONYMS = [
  'description', 'memo', 'name', 'payee', 'details', 'narrative',
  'transaction description', 'merchant',
];
const AMOUNT_SYNONYMS = ['amount', 'value', 'transaction amount'];
const DEBIT_SYNONYMS = ['debit', 'debits', 'withdrawal', 'withdrawals', 'amount debit'];
const CREDIT_SYNONYMS = ['credit', 'credits', 'deposit', 'deposits', 'amount credit'];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export function parseCsv(rawText: string, options: ParseCsvOptions = {}): ParsedStatement {
  const text = stripBom(rawText);
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter).filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''));
  if (rows.length < 1) {
    throw new Error('CSV has no data rows');
  }

  let mapping: ColumnMapping;
  let dataRows: string[][];

  if (options.mapping) {
    // Caller supplied an explicit mapping; assume first row is data unless
    // it doesn't parse, in which case it's probably a header to skip.
    mapping = options.mapping;
    dataRows = rowLooksLikeData(rows[0], mapping) ? rows : rows.slice(1);
  } else if (looksLikeHeader(rows[0])) {
    mapping = detectMappingFromHeader(rows[0]);
    dataRows = rows.slice(1);
  } else {
    mapping = inferMappingFromContent(rows);
    dataRows = rows;
  }

  const transactions: ParsedTransaction[] = [];
  let skippedMissingFields = 0;
  let skippedBadDate = 0;
  let skippedBadAmount = 0;

  for (const row of dataRows) {
    const dateRaw = row[mapping.date]?.trim();
    const descRaw = row[mapping.description]?.trim();
    if (!dateRaw || !descRaw) { skippedMissingFields++; continue; }
    const date = parseDate(dateRaw);
    if (!date) { skippedBadDate++; continue; }

    let amount: number | null = null;
    if (typeof mapping.amount === 'number' && mapping.amount >= 0) {
      amount = parseAmount(row[mapping.amount]);
    } else if (typeof mapping.debit === 'number' || typeof mapping.credit === 'number') {
      const debit = typeof mapping.debit === 'number' ? Math.abs(parseAmount(row[mapping.debit]) ?? 0) : 0;
      const credit = typeof mapping.credit === 'number' ? Math.abs(parseAmount(row[mapping.credit]) ?? 0) : 0;
      const value = credit - debit;
      amount = value === 0 && debit === 0 && credit === 0 ? null : value;
    }
    if (amount === null || Number.isNaN(amount)) { skippedBadAmount++; continue; }

    transactions.push({
      date,
      description: descRaw.replace(/\s+/g, ' ').trim(),
      amount,
    });
  }

  if (transactions.length === 0) {
    throw new Error('CSV parsed but no transactions were extracted (check column mapping)');
  }

  const warnings: string[] = [];
  const totalSkipped = skippedMissingFields + skippedBadDate + skippedBadAmount;
  if (totalSkipped > 0 && totalSkipped / dataRows.length > 0.1) {
    const parts: string[] = [];
    if (skippedBadDate > 0) parts.push(`${skippedBadDate} with unparseable dates`);
    if (skippedBadAmount > 0) parts.push(`${skippedBadAmount} with unparseable amounts`);
    if (skippedMissingFields > 0) parts.push(`${skippedMissingFields} missing required fields`);
    warnings.push(`Skipped ${totalSkipped} of ${dataRows.length} rows (${parts.join(', ')}). Check the column mapping.`);
  }

  return {
    period: inferPeriodFromTransactions(transactions),
    bankType: 'unknown' as never, // CSV is bank-agnostic
    parserUsed: 'csv',
    transactions,
    detectedMapping: mapping,
    delimiter,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Parse a CSV into raw rows + a best-guess mapping. Useful for the
 * preview-before-import flow where we want to show the user what we
 * detected before parsing transactions.
 */
export function inspectCsv(rawText: string): {
  delimiter: string;
  rows: string[][];
  hasHeader: boolean;
  header: string[] | null;
  detectedMapping: ColumnMapping | null;
} {
  const text = stripBom(rawText);
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter).filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''));
  if (rows.length === 0) {
    return { delimiter, rows: [], hasHeader: false, header: null, detectedMapping: null };
  }
  const hasHeader = looksLikeHeader(rows[0]);
  let mapping: ColumnMapping | null = null;
  try {
    mapping = hasHeader ? detectMappingFromHeader(rows[0]) : inferMappingFromContent(rows);
  } catch {
    mapping = null;
  }
  return {
    delimiter,
    rows,
    hasHeader,
    header: hasHeader ? rows[0] : null,
    detectedMapping: mapping,
  };
}

// ── delimiter + row parsing ──────────────────────────────────────────────────

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    // Count occurrences outside of double-quoted regions
    let score = 0;
    let inQuote = false;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample[i];
      if (ch === '"') inQuote = !inQuote;
      else if (!inQuote && ch === d) score++;
    }
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** RFC-4180-ish CSV row parser supporting quoted fields and embedded newlines. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += ch;
  }
  // Trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── header mapping ───────────────────────────────────────────────────────────

function detectMappingFromHeader(header: string[]): ColumnMapping {
  const norm = header.map((h) => h.toLowerCase().trim().replace(/[_-]+/g, ' '));
  const findCol = (synonyms: string[]): number => {
    for (let i = 0; i < norm.length; i++) {
      if (synonyms.includes(norm[i])) return i;
    }
    // Fuzzy contains
    for (let i = 0; i < norm.length; i++) {
      if (synonyms.some((s) => norm[i].includes(s))) return i;
    }
    return -1;
  };

  const date = findCol(DATE_SYNONYMS);
  const description = findCol(DESC_SYNONYMS);
  const amount = findCol(AMOUNT_SYNONYMS);
  const debit = findCol(DEBIT_SYNONYMS);
  const credit = findCol(CREDIT_SYNONYMS);

  if (date < 0) throw new Error('CSV: could not find a "date" column in the header');
  if (description < 0) throw new Error('CSV: could not find a "description" column in the header');
  if (amount < 0 && debit < 0 && credit < 0) {
    throw new Error('CSV: could not find an "amount" or "debit"/"credit" column in the header');
  }

  const mapping: ColumnMapping = { date, description };
  if (amount >= 0) mapping.amount = amount;
  if (debit >= 0) mapping.debit = debit;
  if (credit >= 0) mapping.credit = credit;
  return mapping;
}

/**
 * True if the first row "looks like" column headers (mostly text, no
 * parseable date, no parseable amount). We bias toward false-negative:
 * if any column in row 1 already parses cleanly as a date AND another as
 * a number, assume there's no header.
 */
function looksLikeHeader(row: string[]): boolean {
  let dateCells = 0;
  let numericCells = 0;
  let textCells = 0;
  for (const raw of row) {
    const cell = raw.trim();
    if (cell === '') continue;
    if (parseDate(cell)) { dateCells++; continue; }
    if (parseAmount(cell) !== null && /\d/.test(cell)) { numericCells++; continue; }
    textCells++;
  }
  // If we got both a date and a number in row 1, it's data, not headers.
  if (dateCells >= 1 && numericCells >= 1) return false;
  // Otherwise, if mostly text, treat as header.
  return textCells > dateCells + numericCells;
}

/**
 * Infer a column mapping by sampling actual data rows. For each column,
 * classify it as date-like / amount-like / text-like based on how many of
 * the first N rows parse cleanly. Pick the best candidate for each role.
 */
function inferMappingFromContent(rows: string[][]): ColumnMapping {
  const sample = rows.slice(0, Math.min(20, rows.length));
  const cols = Math.max(...sample.map((r) => r.length));
  type Score = { date: number; amount: number; text: number; nonempty: number; avgLen: number; allPositive: boolean; allNegative: boolean };
  const scores: Score[] = [];

  for (let c = 0; c < cols; c++) {
    let date = 0, amount = 0, text = 0, nonempty = 0, lenSum = 0;
    let pos = 0, neg = 0;
    for (const row of sample) {
      const cell = (row[c] ?? '').trim();
      if (cell === '') continue;
      nonempty++;
      lenSum += cell.length;
      if (parseDate(cell)) { date++; continue; }
      const n = parseAmount(cell);
      if (n !== null && /\d/.test(cell)) {
        amount++;
        if (n > 0) pos++;
        else if (n < 0) neg++;
        continue;
      }
      text++;
    }
    scores.push({
      date, amount, text, nonempty,
      avgLen: nonempty > 0 ? lenSum / nonempty : 0,
      allPositive: amount > 0 && neg === 0,
      allNegative: amount > 0 && pos === 0,
    });
  }

  // Best date column: most date hits
  const dateIdx = bestIndex(scores, (s) => s.date);
  if (dateIdx < 0 || scores[dateIdx].date === 0) {
    throw new Error('CSV: could not detect a date column (no headers and no parseable dates found)');
  }

  // Amount column(s): prefer a single signed column. If there are two
  // amount-heavy columns that are uniformly positive (typical debit/credit
  // split), use the debit/credit pair instead.
  const amountCols = scores
    .map((s, i) => ({ s, i }))
    .filter((x) => x.i !== dateIdx && x.s.amount >= Math.max(1, x.s.nonempty * 0.5))
    .sort((a, b) => b.s.amount - a.s.amount);

  let amount: number | undefined;
  let debit: number | undefined;
  let credit: number | undefined;
  if (amountCols.length === 0) {
    throw new Error('CSV: could not detect an amount column');
  } else if (amountCols.length >= 2 && amountCols[0].s.allPositive && amountCols[1].s.allPositive) {
    // Heuristic: the column with the larger average value tends to be
    // credit/deposit (income); the smaller, debit/expense. Without
    // headers we can't be sure, but the math (credit - debit) still
    // works as long as we're consistent. Default: first = debit, second = credit
    // matching common bank CSV column order.
    debit = amountCols[0].i;
    credit = amountCols[1].i;
  } else {
    amount = amountCols[0].i;
  }

  // Description = longest-average-length text-heavy column that isn't already used.
  const used = new Set<number>([dateIdx, amount, debit, credit].filter((v): v is number => typeof v === 'number'));
  const textCandidates = scores
    .map((s, i) => ({ s, i }))
    .filter((x) => !used.has(x.i) && x.s.text >= Math.max(1, x.s.nonempty * 0.5))
    .sort((a, b) => b.s.avgLen - a.s.avgLen);
  if (textCandidates.length === 0) {
    throw new Error('CSV: could not detect a description column');
  }
  const description = textCandidates[0].i;

  const mapping: ColumnMapping = { date: dateIdx, description };
  if (typeof amount === 'number') mapping.amount = amount;
  if (typeof debit === 'number') mapping.debit = debit;
  if (typeof credit === 'number') mapping.credit = credit;
  return mapping;
}

function bestIndex<T>(arr: T[], score: (x: T) => number): number {
  let bestI = -1;
  let bestS = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const s = score(arr[i]);
    if (s > bestS) { bestS = s; bestI = i; }
  }
  return bestI;
}

/** True if a row parses as a valid data row under the given mapping. */
function rowLooksLikeData(row: string[], mapping: ColumnMapping): boolean {
  const date = row[mapping.date]?.trim();
  if (!date || !parseDate(date)) return false;
  if (typeof mapping.amount === 'number') {
    const n = parseAmount(row[mapping.amount]);
    return n !== null;
  }
  if (typeof mapping.debit === 'number' || typeof mapping.credit === 'number') {
    const d = typeof mapping.debit === 'number' ? parseAmount(row[mapping.debit]) : null;
    const c = typeof mapping.credit === 'number' ? parseAmount(row[mapping.credit]) : null;
    return d !== null || c !== null;
  }
  return false;
}

// ── value parsers ────────────────────────────────────────────────────────────

function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === '') return null;
  const parenNeg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()$,\s]/g, '').replace(/[A-Za-z]+$/, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return parenNeg ? -Math.abs(n) : n;
}

/** Return YYYY-MM-DD or null if unparseable. Supports several common shapes. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  // ISO YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // MM/DD/YYYY or M/D/YYYY (US default)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  // MM/DD/YY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) return iso(2000 + +m[3], +m[1], +m[2]);
  // DD-MMM-YYYY  (e.g. 04-Jan-2026)
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon) return iso(+m[3], mon, +m[1]);
  }
  // MMM DD, YYYY  (e.g. Jan 4, 2026)
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon) return iso(+m[3], mon, +m[2]);
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}
