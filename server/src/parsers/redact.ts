/**
 * Redact PII from bank-statement text before storing as an unknown-format sample.
 *
 * Rules (applied in order):
 *  1. 16-digit cards formatted 4-4-4-4 with spaces or hyphens  → keep last 4
 *  2. 15-digit AmEx formatted 4-6-5                            → keep last 4
 *  3. 14-digit cards formatted 4-6-4                           → keep last 4
 *  4. Unbroken 8-16 digit sequences (card/account/routing)     → keep last 4
 *  5. SSN (NNN-NN-NNNN)                                        → XXX-XX-XXXX
 *  6. Email addresses                                          → [email]
 *  7. Phone numbers (common US formats)                        → [phone]
 *
 * Transaction rows (date + amount + description) are preserved so the sample
 * remains useful for parser development.
 */
export function redactText(text: string): string {
  // Mask every digit in `m` except the trailing run of 4.
  const keepLast4 = (m: string): string => m.replace(/\d(?=.*\d{4}\b)/g, 'X');

  return text
    // Formatted card numbers — must run before the unbroken-digit rule
    .replace(/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g, keepLast4)
    .replace(/\b\d{4}[ -]\d{6}[ -]\d{5}\b/g, keepLast4)
    .replace(/\b\d{4}[ -]\d{6}[ -]\d{4}\b/g, keepLast4)
    // Unbroken 8-16 digit sequences
    .replace(/\b\d{8,16}\b/g, (m) => 'X'.repeat(m.length - 4) + m.slice(-4))
    // SSN
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, 'XXX-XX-XXXX')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[email]')
    // Phone numbers — (NNN) NNN-NNNN, NNN-NNN-NNNN, NNN.NNN.NNNN
    .replace(/(?<!\d)\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}(?!\d)/g, '[phone]');
}
