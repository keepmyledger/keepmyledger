import { ParsedStatement } from '../../parsers/types';
import { mtParser } from '../../parsers/mt';
import { PositionedLine } from '../../parsers/pdfPositional';

// M&T column x-coordinates used in fixtures
// These mirror a typical M&T statement layout
const COL = {
  date: 50,
  description: 140,
  deposits: 350,
  withdrawals: 450,
  balance: 550,
} as const;

/** Build the M&T column header line (required for column detection). */
function mtHeaderLine(y = 800): PositionedLine {
  return {
    page: 1,
    y,
    items: [
      { text: 'POSTING', x: COL.date, y, width: 50, page: 1 },
      { text: 'DEPOSITS & OTHER', x: COL.deposits, y, width: 80, page: 1 },
      { text: 'WITHDRAWALS &', x: COL.withdrawals, y, width: 80, page: 1 },
      { text: 'DAILY', x: COL.balance, y, width: 40, page: 1 },
    ],
  };
}

/** Build a deposit (credit) transaction row. */
function mtDepositLine(page: number, y: number, date: string, description: string, amount: string): PositionedLine {
  return {
    page,
    y,
    items: [
      { text: date, x: COL.date, y, width: 60, page },
      { text: description, x: COL.description, y, width: 100, page },
      { text: amount, x: COL.deposits, y, width: 60, page },
      { text: '1,234.56', x: COL.balance, y, width: 60, page },
    ],
  };
}

/** Build a withdrawal (debit) transaction row. */
function mtWithdrawalLine(page: number, y: number, date: string, description: string, amount: string): PositionedLine {
  return {
    page,
    y,
    items: [
      { text: date, x: COL.date, y, width: 60, page },
      { text: description, x: COL.description, y, width: 100, page },
      { text: amount, x: COL.withdrawals, y, width: 60, page },
      { text: '1,000.00', x: COL.balance, y, width: 60, page },
    ],
  };
}

describe('mtParser', () => {
  it('canParse() recognises M&T statements', () => {
    expect(mtParser.canParse('Manufacturers and Traders Trust Company')).toBe(true);
    expect(mtParser.canParse('M&T Bank Statement')).toBe(true);
  });

  it('canParse() rejects other banks', () => {
    expect(mtParser.canParse('American Express Card')).toBe(false);
    expect(mtParser.canParse('JPMorgan Chase Bank, N.A.')).toBe(false);
  });

  it('parse() returns empty transactions (text-only is unreliable)', () => {
    const result = mtParser.parse('Manufacturers and Traders Trust Company\nSome text') as ParsedStatement;
    expect(result.transactions).toHaveLength(0);
    expect(result.bankType).toBe('mt');
  });

  it('parsePositional() returns empty when column header is missing', () => {
    const lines: PositionedLine[] = [
      // No header line with DEPOSITS/WITHDRAWALS/DAILY
      mtDepositLine(1, 700, '01/15/2026', 'DIRECT DEPOSIT', '$1,500.00'),
    ];
    const result = mtParser.parsePositional!(lines, 'M&T Bank') as ParsedStatement;
    expect(result.transactions).toHaveLength(0);
  });

  it('parsePositional() extracts deposits (credits) with positive sign', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      mtDepositLine(1, 700, '01/15/2026', 'DIRECT DEPOSIT', '$1,500.00'),
    ];
    const text = 'Manufacturers and Traders Trust Company\nSTATEMENT PERIOD 01/01/26 - 01/31/26';

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.bankType).toBe('mt');
    expect(result.parserUsed).toBe('template');
    expect(result.transactions).toHaveLength(1);

    const tx = result.transactions[0];
    expect(tx.date).toBe('2026-01-15');
    expect(tx.description).toBe('DIRECT DEPOSIT');
    expect(tx.amount).toBeGreaterThan(0);
    expect(tx.amount).toBeCloseTo(1500.0);
  });

  it('parsePositional() extracts withdrawals (debits) with negative sign', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      mtWithdrawalLine(1, 700, '01/20/2026', 'GROCERY STORE', '$45.50'),
    ];
    const text = 'Manufacturers and Traders Trust Company\nSTATEMENT PERIOD 01/01/26 - 01/31/26';

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBeCloseTo(-45.50);
    expect(result.transactions[0].description).toBe('GROCERY STORE');
  });

  it('parsePositional() extracts multiple transactions with correct signs', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      mtDepositLine(1, 750, '01/01/2026', 'PAYROLL', '$2,000.00'),
      mtWithdrawalLine(1, 720, '01/05/2026', 'RENT PAYMENT', '$850.00'),
      mtWithdrawalLine(1, 690, '01/10/2026', 'ELECTRIC BILL', '$75.00'),
      mtDepositLine(1, 660, '01/15/2026', 'TRANSFER IN', '$300.00'),
    ];
    const text = 'Manufacturers and Traders Trust Company\nSTATEMENT PERIOD 01/01/26 - 01/31/26';

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;

    expect(result.transactions).toHaveLength(4);

    const payroll = result.transactions.find((t) => t.description === 'PAYROLL');
    const rent = result.transactions.find((t) => t.description === 'RENT PAYMENT');
    const electric = result.transactions.find((t) => t.description === 'ELECTRIC BILL');
    const transfer = result.transactions.find((t) => t.description === 'TRANSFER IN');

    expect(payroll?.amount).toBeGreaterThan(0);
    expect(rent?.amount).toBeLessThan(0);
    expect(electric?.amount).toBeLessThan(0);
    expect(transfer?.amount).toBeGreaterThan(0);
  });

  it('parsePositional() derives period from STATEMENT PERIOD header', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      mtDepositLine(1, 700, '03/10/2026', 'PAYROLL', '$1,000.00'),
    ];
    const text = 'Manufacturers and Traders Trust Company\nSTATEMENT PERIOD 03/01/26 - 03/31/26';

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.period).toBe('2026-03');
  });

  it('parsePositional() falls back to inferring period from transactions', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      mtDepositLine(1, 700, '05/20/2026', 'PAYROLL', '$1,000.00'),
    ];
    const text = 'Manufacturers and Traders Trust Company'; // no STATEMENT PERIOD line

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.period).toBe('2026-05');
  });

  it('parsePositional() skips BEGINNING BALANCE and ENDING BALANCE rows', () => {
    const lines: PositionedLine[] = [
      mtHeaderLine(800),
      {
        page: 1, y: 750,
        items: [
          { text: '01/01/2026', x: COL.date, y: 750, width: 60, page: 1 },
          { text: 'BEGINNING BALANCE', x: COL.description, y: 750, width: 100, page: 1 },
          { text: '$5,000.00', x: COL.balance, y: 750, width: 60, page: 1 },
        ],
      },
      mtWithdrawalLine(1, 700, '01/05/2026', 'ATM WITHDRAWAL', '$100.00'),
      {
        page: 1, y: 650,
        items: [
          { text: '01/31/2026', x: COL.date, y: 650, width: 60, page: 1 },
          { text: 'ENDING BALANCE', x: COL.description, y: 650, width: 100, page: 1 },
          { text: '$4,900.00', x: COL.balance, y: 650, width: 60, page: 1 },
        ],
      },
    ];
    const text = 'Manufacturers and Traders Trust Company';

    const result = mtParser.parsePositional!(lines, text) as ParsedStatement;
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('ATM WITHDRAWAL');
  });
});
