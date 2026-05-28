import { ParsedStatement } from '../../parsers/types';
import { chaseParser } from '../../parsers/chase';
import { PositionedLine } from '../../parsers/pdfPositional';

/** Build a single positional line for a Chase transaction row. */
function chaseLine(
  page: number,
  y: number,
  date: string,
  description: string,
  amount: string
): PositionedLine {
  return {
    page,
    y,
    items: [
      { text: date, x: 50, y, width: 30, page },
      { text: description, x: 100, y, width: 150, page },
      { text: amount, x: 500, y, width: 50, page },
    ],
  };
}

describe('chaseParser', () => {
  it('canParse() recognises Chase statements', () => {
    expect(chaseParser.canParse('Customer Service: chase.com')).toBe(true);
    expect(chaseParser.canParse('JPMorgan Chase Bank, N.A.')).toBe(true);
    expect(chaseParser.canParse('Chase Mobile')).toBe(true);
  });

  it('canParse() rejects other banks', () => {
    expect(chaseParser.canParse('American Express Card')).toBe(false);
    expect(chaseParser.canParse('Manufacturers and Traders Trust Company')).toBe(false);
  });

  it('parse() returns empty transactions (text-only fallback)', () => {
    const result = chaseParser.parse('Chase Bank\nAccount Activity') as ParsedStatement;
    expect(result.transactions).toHaveLength(0);
    expect(result.bankType).toBe('chase');
  });

  it('parsePositional() extracts purchases (positive amounts)', () => {
    // Closing period: 12/09/25 - 01/08/26
    const text = 'JPMorgan Chase Bank, N.A.\nOpening/Closing Date 12/09/25 - 01/08/26\nAccount Activity';
    const lines: PositionedLine[] = [
      chaseLine(1, 700, '01/05', 'STARBUCKS #12345', '4.75'),
      chaseLine(1, 680, '01/07', 'AMAZON WEB SERVICES', '99.00'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.bankType).toBe('chase');
    expect(result.parserUsed).toBe('template');
    expect(result.period).toBe('2026-01');
    expect(result.transactions).toHaveLength(2);

    const starbucks = result.transactions[0];
    expect(starbucks.date).toBe('2026-01-05');
    expect(starbucks.description).toBe('STARBUCKS #12345');
    expect(starbucks.amount).toBe(4.75);

    const aws = result.transactions[1];
    expect(aws.date).toBe('2026-01-07');
    expect(aws.amount).toBe(99.0);
  });

  it('parsePositional() extracts payments (negative amounts)', () => {
    const text = 'JPMorgan Chase Bank, N.A.\nOpening/Closing Date 12/09/25 - 01/08/26';
    const lines: PositionedLine[] = [
      chaseLine(1, 700, '01/03', 'PAYMENT THANK YOU', '-500.00'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(-500.0);
    expect(result.transactions[0].description).toBe('PAYMENT THANK YOU');
  });

  it('parsePositional() assigns prior year for Dec rows on a Jan statement', () => {
    // Dec/Jan crossover: opening in Dec 2025, closing in Jan 2026
    const text = 'JPMorgan Chase Bank, N.A.\nOpening/Closing Date 12/09/25 - 01/08/26';
    const lines: PositionedLine[] = [
      chaseLine(1, 720, '12/15', 'HOLIDAY STORE', '50.00'),  // Dec → 2025
      chaseLine(1, 700, '01/03', 'NEW YEAR SHOP', '25.00'),  // Jan → 2026
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.transactions).toHaveLength(2);

    const dec = result.transactions.find((t) => t.description === 'HOLIDAY STORE');
    const jan = result.transactions.find((t) => t.description === 'NEW YEAR SHOP');

    expect(dec?.date).toBe('2025-12-15');
    expect(jan?.date).toBe('2026-01-03');
  });

  it('parsePositional() derives period from Opening/Closing Date header', () => {
    const text = 'chase.com\nOpening/Closing Date 03/10/26 - 04/09/26';
    const lines: PositionedLine[] = [
      chaseLine(1, 700, '04/01', 'GROCERY', '30.00'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.period).toBe('2026-04');
  });

  it('parsePositional() falls back to inferring period from transactions', () => {
    const text = 'JPMorgan Chase Bank, N.A.'; // no period header
    const lines: PositionedLine[] = [
      chaseLine(1, 700, '06/15', 'SUMMER SHOP', '45.00'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;
    // Without a period header, year defaults to current year and month is inferred
    expect(result.period).toMatch(/^\d{4}-06$/);
  });

  it('parsePositional() skips lines without a leading MM/DD date', () => {
    const text = 'JPMorgan Chase Bank, N.A.\nOpening/Closing Date 01/09/26 - 02/08/26';
    const lines: PositionedLine[] = [
      // Header - no date
      { page: 1, y: 750, items: [{ text: 'PURCHASES', x: 50, y: 750, width: 80, page: 1 }] },
      chaseLine(1, 700, '01/15', 'VALID TX', '20.00'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('VALID TX');
  });

  it('parsePositional() handles comma-separated amounts (thousands)', () => {
    const text = 'JPMorgan Chase Bank, N.A.\nOpening/Closing Date 01/09/26 - 02/08/26';
    const lines: PositionedLine[] = [
      chaseLine(1, 700, '02/01', 'BIG PURCHASE', '1,234.56'),
    ];

    const result = chaseParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions[0].amount).toBeCloseTo(1234.56);
  });
});
