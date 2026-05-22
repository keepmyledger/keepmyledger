import { parseQif, parseQifDate, parseQifAmount } from '../../parsers/qif';

describe('parseQif', () => {
  it('parses a basic Bank-type QIF file', () => {
    const qif = [
      '!Type:Bank',
      'D01/04/2026',
      'T-1234.56',
      'PGROCERY STORE',
      'MMemo text',
      '^',
      'D01/10/2026',
      'T2500.00',
      'PSalary Deposit',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.parserUsed).toBe('qif');
    expect(r.qifAccountType).toBe('bank');
    expect(r.period).toBe('2026-01');
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'GROCERY STORE – Memo text', amount: -1234.56 },
      { date: '2026-01-10', description: 'Salary Deposit', amount: 2500 },
    ]);
  });

  it('flips sign for CCard accounts (charge becomes negative)', () => {
    const qif = [
      '!Type:CCard',
      'D02/15/2026',
      'T49.99',
      'PAMAZON',
      '^',
      'D02/20/2026',
      'T-200.00',
      'PPayment Thank You',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.qifAccountType).toBe('ccard');
    expect(r.transactions[0]).toMatchObject({ description: 'AMAZON', amount: -49.99 });
    expect(r.transactions[1]).toMatchObject({ description: 'Payment Thank You', amount: 200 });
  });

  it('omits memo from description when memo equals payee', () => {
    const qif = [
      '!Type:Bank',
      'D03/01/2026',
      'T-50.00',
      'PSTARBUCKS',
      'MSTARBUCKS',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.transactions[0].description).toBe('STARBUCKS');
  });

  it('appends memo to description when they differ', () => {
    const qif = [
      '!Type:Bank',
      'D03/01/2026',
      'T-50.00',
      'PSTARBUCKS',
      'MOak St location',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.transactions[0].description).toBe('STARBUCKS – Oak St location');
  });

  it('uses memo as description when payee is absent', () => {
    const qif = [
      '!Type:Bank',
      'D03/05/2026',
      'T-10.00',
      'MCoffee shop',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.transactions[0].description).toBe('Coffee shop');
  });

  it('handles CRLF line endings and BOM', () => {
    const qif = '\uFEFF!Type:Bank\r\nD01/04/2026\r\nT-5.00\r\nPTEST\r\n^\r\n';
    const r = parseQif(qif);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe(-5);
  });

  it('handles files with no trailing ^ on last record', () => {
    const qif = '!Type:Bank\nD04/01/2026\nT100.00\nPDEPOSIT';
    const r = parseQif(qif);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe(100);
  });

  it('throws when the file contains no transactions', () => {
    expect(() => parseQif('!Type:Bank\n')).toThrow('No transactions found');
  });

  it('skips records with unparseable date or amount', () => {
    const qif = [
      '!Type:Bank',
      'DBADDATE',
      'T-50.00',
      'PBAD TX',
      '^',
      'D01/04/2026',
      'T-10.00',
      'PGOOD TX',
      '^',
    ].join('\n');
    const r = parseQif(qif);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].description).toBe('GOOD TX');
  });
});

describe('parseQifDate', () => {
  const cases: [string, string][] = [
    ['1/4/2026', '2026-01-04'],
    ['01/04/2026', '2026-01-04'],
    ['1/4/26', '2026-01-04'],
    ['2026-01-04', '2026-01-04'],
    ['2026/01/04', '2026-01-04'],
    ['4-Jan-2026', '2026-01-04'],
    ["1- 4'26", '2026-01-04'],  // Quicken's unusual format
  ];
  for (const [input, expected] of cases) {
    it(`parses ${input}`, () => expect(parseQifDate(input)).toBe(expected));
  }
  it('returns null for garbage', () => expect(parseQifDate('not a date')).toBeNull());
});

describe('parseQifAmount', () => {
  it('parses negative amount', () => expect(parseQifAmount('-1,234.56')).toBe(-1234.56));
  it('parses positive amount', () => expect(parseQifAmount('500.00')).toBe(500));
  it('parses parenthesized as negative', () => expect(parseQifAmount('(50.00)')).toBe(-50));
  it('handles European decimal comma', () => expect(parseQifAmount('-1.234,56')).toBe(-1234.56));
});
