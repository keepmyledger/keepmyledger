/**
 * OFX / QFX parser.
 *
 * Handles both OFX 1.x (SGML, unclosed leaf tags) and OFX 2.x (XML).
 * QFX is OFX 1.x with Intuit-specific headers — structurally identical.
 *
 * Sign convention on output: negative = expense/money-out, positive = income.
 * OFX TRNAMT already encodes this from the account-holder's perspective, so
 * no flip is applied (contrast with QIF's CCard convention).
 *
 * FITID mix-in: when the bank provides a <FITID>, it is appended to the
 * description as " [FITID:xxx]" so the existing hashTransaction dedup key
 * remains stable across re-imports even when name+amount collide.
 */
import { ParsedStatement, ParsedTransaction } from './types';
import { inferPeriodFromTransactions } from './utils';

// ── Public API ────────────────────────────────────────────────────────────────

export function parseOfx(rawText: string): ParsedStatement {
  const text = normalizeLineEndings(rawText);
  const body = extractBody(text);
  const transactions = extractTransactions(body);

  if (transactions.length === 0) {
    throw new Error('No transactions found in OFX file');
  }

  const period = inferPeriodFromTransactions(transactions);
  return { period, bankType: 'ofx', parserUsed: 'ofx', transactions };
}

// ── Body extraction ───────────────────────────────────────────────────────────

/**
 * Strip OFX 1.x header block (lines before the first <OFX> tag) and any
 * XML processing instructions from OFX 2.x, then return the content from
 * <OFX> onward.
 */
function extractBody(text: string): string {
  const start = text.indexOf('<OFX>');
  if (start === -1) {
    // Try case-insensitive (malformed emitters)
    const ci = text.search(/<OFX>/i);
    if (ci === -1) throw new Error('File does not appear to be a valid OFX (no <OFX> block found)');
    return normalizeSgml(text.slice(ci));
  }
  return normalizeSgml(text.slice(start));
}

/**
 * Normalize OFX 1.x SGML to something we can extract tags from reliably.
 * Leaf tags in 1.x have no closing tag: `<TRNAMT>-4.75\n`.
 * We auto-close them so later regex searches work identically on 1.x and 2.x.
 *
 * A leaf tag: starts with `<TAGNAME>` followed immediately by a non-`<` value
 * and ending at end-of-line (or before the next `<`).
 */
function normalizeSgml(text: string): string {
  // Match <TAG>value where value does not contain < and there is no </TAG> already
  return text.replace(/<([A-Z][A-Z0-9._]*)>([^<\n\r]+)/g, (match, tag: string, value: string) => {
    const closeTag = `</${tag}>`;
    if (match.includes(closeTag)) return match; // already closed (2.x)
    return `<${tag}>${value.trimEnd()}</${tag}>`;
  });
}

// ── Transaction extraction ────────────────────────────────────────────────────

function extractTransactions(body: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  // Match both <STMTTRN> (bank) and <CCSTMTTRN> (credit card) — OFX uses the
  // same inner structure; CCSTMTTRN is just a synonym in some issuer files.
  const blockRe = /<(?:CC)?STMTTRN>([\s\S]*?)<\/(?:CC)?STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body)) !== null) {
    const block = m[1];
    const tx = parseTransaction(block);
    if (tx) transactions.push(tx);
  }
  return transactions;
}

function parseTransaction(block: string): ParsedTransaction | null {
  const date = extractDate(block);
  if (!date) return null;

  const amount = extractAmount(block);
  if (amount === null) return null;

  const description = buildDescription(block);
  return { date, description, amount };
}

// ── Field extractors ─────────────────────────────────────────────────────────

function extractTagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

/**
 * OFX date formats: YYYYMMDD, YYYYMMDDHHMMSS, YYYYMMDDHHMMSS.xxx,
 * optionally followed by [±H:TZ] or [±H.H:TZ].
 * We take the first 8 characters only.
 */
function extractDate(block: string): string | null {
  const raw = extractTagValue(block, 'DTPOSTED') ?? extractTagValue(block, 'DTUSER');
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const mo = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

function extractAmount(block: string): number | null {
  const raw = extractTagValue(block, 'TRNAMT');
  if (!raw) return null;
  return parseAmount(raw);
}

function buildDescription(block: string): string {
  const name = extractTagValue(block, 'NAME') ?? '';
  const memo = extractTagValue(block, 'MEMO') ?? '';
  const fitid = extractTagValue(block, 'FITID') ?? '';

  let description = name;
  const memoClean = memo.trim();
  if (memoClean && memoClean.toLowerCase() !== description.toLowerCase()) {
    description = description ? `${description} – ${memoClean}` : memoClean;
  }
  if (!description) description = '(no description)';

  if (fitid) description = `${description} [FITID:${fitid}]`;
  return description;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parse an OFX amount string. Handles:
 *   -1234.56   1234.56   -1,234.56   (500.00)   European -1.234,56
 */
function parseAmount(s: string): number | null {
  let v = s.trim();
  const negative = v.startsWith('-') || (v.startsWith('(') && v.endsWith(')'));
  v = v.replace(/[()]/g, '').replace(/^-/, '').trim();

  // European decimal: last separator is a comma with 1-2 digits after
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
