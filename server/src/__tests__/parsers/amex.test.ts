import { ParsedStatement } from '../../parsers/types';
import { amexParser } from '../../parsers/amex';
import { PositionedLine } from '../../parsers/pdfPositional';

/** Build a single positional line for an Amex transaction row. */
function amexLine(
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
      { text: date, x: 50, y, width: 40, page },
      { text: description, x: 120, y, width: 100, page },
      { text: amount, x: 500, y, width: 40, page },
    ],
  };
}

describe('amexParser', () => {
  it('canParse() recognises Amex statements', () => {
    expect(amexParser.canParse('American Express Card')).toBe(true);
    expect(amexParser.canParse('Prepared for JANE DOE\nAmerican Express\nAccount Ending 1-23456')).toBe(true);
  });

  it('canParse() rejects other banks', () => {
    expect(amexParser.canParse('Chase Bank\nAccount Activity')).toBe(false);
    expect(amexParser.canParse('Manufacturers and Traders Trust Company')).toBe(false);
  });

  it('parse() returns empty transactions (text-only is unreliable)', () => {
    const result = amexParser.parse('American Express\nSome statement text') as ParsedStatement;
    expect(result.transactions).toHaveLength(0);
    expect(result.bankType).toBe('amex');
  });

  it('parsePositional() extracts charges (positive) correctly', () => {
    const lines: PositionedLine[] = [
      amexLine(1, 700, '01/15/26', 'STARBUCKS', '$4.75'),
      amexLine(1, 680, '01/20/26', 'AMAZON.COM', '$129.99'),
    ];
    const text = 'American Express\nClosing Date 01/31/26';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.bankType).toBe('amex');
    expect(result.parserUsed).toBe('template');
    expect(result.transactions).toHaveLength(2);

    const starbucks = result.transactions[0];
    expect(starbucks.date).toBe('2026-01-15');
    expect(starbucks.description).toBe('STARBUCKS');
    expect(starbucks.amount).toBe(4.75);

    const amazon = result.transactions[1];
    expect(amazon.date).toBe('2026-01-20');
    expect(amazon.amount).toBe(129.99);
  });

  it('parsePositional() extracts payments (negative amounts) correctly', () => {
    const lines: PositionedLine[] = [
      amexLine(1, 700, '01/05/26', 'PAYMENT - THANK YOU', '-$500.00'),
    ];
    const text = 'American Express\nClosing Date 01/31/26';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(-500.0);
    expect(result.transactions[0].description).toBe('PAYMENT - THANK YOU');
  });

  it('parsePositional() derives period from Closing Date header', () => {
    const lines: PositionedLine[] = [
      amexLine(1, 700, '01/15/26', 'COFFEE SHOP', '$5.00'),
    ];
    const text = 'American Express\nClosing Date 01/31/26';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.period).toBe('2026-01');
  });

  it('parsePositional() falls back to inferring period from transactions', () => {
    const lines: PositionedLine[] = [
      amexLine(1, 700, '03/10/26', 'SHOP', '$20.00'),
      amexLine(1, 680, '03/15/26', 'CAFE', '$8.00'),
    ];
    const text = 'American Express'; // no Closing Date line

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.period).toBe('2026-03');
  });

  it('parsePositional() skips lines without a leading date', () => {
    const lines: PositionedLine[] = [
      // Header line — no date
      { page: 1, y: 750, items: [{ text: 'Account Activity', x: 50, y: 750, width: 100, page: 1 }] },
      amexLine(1, 700, '01/15/26', 'STARBUCKS', '$4.75'),
    ];
    const text = 'American Express\nClosing Date 01/31/26';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions).toHaveLength(1);
  });

  it('parsePositional() skips lines where last item is not an amount', () => {
    const lines: PositionedLine[] = [
      {
        page: 1, y: 700, items: [
          { text: '01/15/26', x: 50, y: 700, width: 40, page: 1 },
          { text: 'STARBUCKS', x: 120, y: 700, width: 100, page: 1 },
          // last item is not an amount
          { text: 'CA', x: 500, y: 700, width: 20, page: 1 },
        ],
      },
    ];
    const text = 'American Express';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions).toHaveLength(0);
  });

  it('parsePositional() handles date with asterisk (pending transactions)', () => {
    const lines: PositionedLine[] = [
      amexLine(1, 700, '02/01/26*', 'PENDING MERCHANT', '$12.00'),
    ];
    const text = 'American Express\nClosing Date 02/28/26';

    const result = amexParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date).toBe('2026-02-01');
  });
});
