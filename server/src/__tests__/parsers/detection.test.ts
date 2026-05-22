import { findTemplateParser } from '../../parsers';

describe('parsers/findTemplateParser', () => {
  it('detects Amex statements', () => {
    const p = findTemplateParser('Prepared for JANE DOE\nAmerican Express\nAccount Ending 1-23456');
    expect(p?.bankType).toBe('amex');
  });

  it('detects Chase statements (chase.com)', () => {
    const p = findTemplateParser('Customer Service: chase.com\nAccount Activity');
    expect(p?.bankType).toBe('chase');
  });

  it('detects Chase statements (JPMorgan Chase)', () => {
    const p = findTemplateParser('JPMorgan Chase Bank, N.A.');
    expect(p?.bankType).toBe('chase');
  });

  it('detects M&T statements', () => {
    const p = findTemplateParser('Manufacturers and Traders Trust Company');
    expect(p?.bankType).toBe('mt');
  });

  it('returns null for unknown banks', () => {
    expect(findTemplateParser('Wells Fargo Bank, N.A.')).toBeNull();
  });
});
