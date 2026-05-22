import { normalizeAmount, inferPeriodFromTransactions, hashTransaction } from '../../parsers/utils';

describe('parsers/utils', () => {
  describe('normalizeAmount', () => {
    it('strips $ and commas', () => {
      expect(normalizeAmount('$1,234.56', 'mt')).toBe(1234.56);
    });
    it('treats parens as negative', () => {
      expect(normalizeAmount('($25.00)', 'mt')).toBe(-25);
    });
    it('preserves leading minus', () => {
      expect(normalizeAmount('-12.50', 'amex')).toBe(-12.5);
    });
    it('treats unsigned as positive', () => {
      expect(normalizeAmount('99.99', 'chase')).toBe(99.99);
    });
  });

  describe('inferPeriodFromTransactions', () => {
    it('picks the most common YYYY-MM', () => {
      const period = inferPeriodFromTransactions([
        { date: '2026-01-05', description: 'a', amount: 1 },
        { date: '2026-01-12', description: 'b', amount: 2 },
        { date: '2026-02-01', description: 'c', amount: 3 },
      ]);
      expect(period).toBe('2026-01');
    });
    it('falls back to current month when empty', () => {
      const p = inferPeriodFromTransactions([]);
      expect(p).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('hashTransaction', () => {
    it('is deterministic', () => {
      const a = hashTransaction(1, '2026-01-05', 'STARBUCKS  STORE', -5.5);
      const b = hashTransaction(1, '2026-01-05', 'STARBUCKS  STORE', -5.5);
      expect(a).toBe(b);
    });
    it('normalizes case and whitespace in description', () => {
      const a = hashTransaction(1, '2026-01-05', 'Starbucks Store', -5.5);
      const b = hashTransaction(1, '2026-01-05', 'STARBUCKS    STORE', -5.5);
      expect(a).toBe(b);
    });
    it('differs across account, amount, date, description', () => {
      const base = hashTransaction(1, '2026-01-05', 'X', -5);
      expect(hashTransaction(2, '2026-01-05', 'X', -5)).not.toBe(base);
      expect(hashTransaction(1, '2026-01-06', 'X', -5)).not.toBe(base);
      expect(hashTransaction(1, '2026-01-05', 'Y', -5)).not.toBe(base);
      expect(hashTransaction(1, '2026-01-05', 'X', -6)).not.toBe(base);
    });
  });
});
