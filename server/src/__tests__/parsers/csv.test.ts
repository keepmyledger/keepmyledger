import { parseCsv, parseDate, inspectCsv } from '../../parsers/csv';

describe('parseCsv', () => {
  it('parses a simple comma-delimited file with a single signed amount column', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-01-04,STARBUCKS #123,-4.75',
      '2026-01-05,PAYROLL,2500.00',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.parserUsed).toBe('csv');
    expect(r.period).toBe('2026-01');
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'STARBUCKS #123', amount: -4.75 },
      { date: '2026-01-05', description: 'PAYROLL', amount: 2500 },
    ]);
  });

  it('handles split debit / credit columns (amount = credit - debit)', () => {
    const csv = [
      'Posted Date,Description,Debit,Credit',
      '01/04/2026,GROCERY,52.10,',
      '01/05/2026,REFUND,,12.00',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'GROCERY', amount: -52.10 },
      { date: '2026-01-05', description: 'REFUND', amount: 12 },
    ]);
  });

  it('respects quoted descriptions containing the delimiter', () => {
    const csv = [
      'Date,Description,Amount',
      '"2026-01-04","SMITH, JOHN PAYMENT",-100.00',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions[0].description).toBe('SMITH, JOHN PAYMENT');
    expect(r.transactions[0].amount).toBe(-100);
  });

  it('detects semicolon delimiter', () => {
    const csv = [
      'Date;Description;Amount',
      '2026-01-04;COFFEE;-3,50',
    ].join('\n');
    // European decimal comma is NOT supported; just verify delimiter sniffing
    // separates columns correctly (amount will fail to parse cleanly here).
    const r = parseCsv(csv.replace('-3,50', '-3.50'));
    expect(r.transactions[0]).toEqual({
      date: '2026-01-04',
      description: 'COFFEE',
      amount: -3.5,
    });
  });

  it('detects tab delimiter', () => {
    const csv = [
      'Date\tDescription\tAmount',
      '2026-01-04\tCOFFEE\t-3.50',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions[0].amount).toBe(-3.5);
  });

  it('strips BOM and tolerates CRLF line endings', () => {
    const csv = '\uFEFFDate,Description,Amount\r\n2026-01-04,X,-1.00\r\n';
    const r = parseCsv(csv);
    expect(r.transactions[0]).toEqual({ date: '2026-01-04', description: 'X', amount: -1 });
  });

  it('treats parenthesized amounts as negative and strips $ and commas', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-01-04,A,"($1,234.56)"',
      '2026-01-05,B,"$2,000.00"',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions[0].amount).toBe(-1234.56);
    expect(r.transactions[1].amount).toBe(2000);
  });

  it('recognises header synonyms (Memo, Posting Date)', () => {
    const csv = [
      'Posting Date,Memo,Amount',
      '01/04/2026,FOO,-1.00',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions[0].description).toBe('FOO');
  });

  it('throws when required columns are missing', () => {
    const csv = 'Foo,Bar\n1,2';
    expect(() => parseCsv(csv)).toThrow(/date/);
  });

  it('throws when there are no data rows', () => {
    expect(() => parseCsv('Date,Description,Amount')).toThrow(/no transactions/);
  });

  it('skips rows with unparseable dates or amounts but keeps valid ones', () => {
    const csv = [
      'Date,Description,Amount',
      'not-a-date,BAD,1.00',
      '2026-01-04,GOOD,-1.00',
      '2026-01-05,NO_AMOUNT,',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'GOOD', amount: -1 },
    ]);
  });

  it('warns when more than 10% of rows are skipped', () => {
    // 1 good, 2 bad → 66% skipped, should warn
    const csv = [
      'Date,Description,Amount',
      '2026-01-01,GOOD,1.00',
      'bad-date,X,1.00',
      '2026-01-02,Y,not-a-number',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions).toHaveLength(1);
    expect(r.warnings).toBeDefined();
    expect(r.warnings![0]).toMatch(/Skipped 2 of 3 rows/);
    expect(r.warnings![0]).toMatch(/unparseable dates/);
    expect(r.warnings![0]).toMatch(/unparseable amounts/);
  });

  it('does not emit warnings when the skip rate is at or below 10%', () => {
    // 10 good, 1 bad → 9% skipped
    const lines = ['Date,Description,Amount'];
    for (let i = 1; i <= 10; i++) lines.push(`2026-01-${String(i).padStart(2, '0')},OK${i},1.00`);
    lines.push('bad,X,1.00');
    const r = parseCsv(lines.join('\n'));
    expect(r.transactions).toHaveLength(10);
    expect(r.warnings).toBeUndefined();
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-01-04', '2026-01-04'],
    ['2026/01/04', '2026-01-04'],
    ['01/04/2026', '2026-01-04'],
    ['1/4/2026', '2026-01-04'],
    ['01/04/26', '2026-01-04'],
    ['04-Jan-2026', '2026-01-04'],
    ['Jan 4, 2026', '2026-01-04'],
  ])('parses %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('returns null for garbage', () => {
    expect(parseDate('hello')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseCsv (headerless)', () => {
  it('infers columns from content when row 1 is data (date,desc,amount)', () => {
    const csv = [
      '2026-01-04,STARBUCKS,-4.75',
      '2026-01-05,PAYROLL,2500.00',
      '2026-01-06,RENT,-1200.00',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'STARBUCKS', amount: -4.75 },
      { date: '2026-01-05', description: 'PAYROLL', amount: 2500 },
      { date: '2026-01-06', description: 'RENT', amount: -1200 },
    ]);
    expect(r.detectedMapping).toEqual({ date: 0, description: 1, amount: 2 });
  });

  it('headerless with split debit/credit columns', () => {
    // date, desc, debit, credit; both amount columns positive
    const csv = [
      '01/04/2026,GROCERY,52.10,',
      '01/05/2026,REFUND,,12.00',
      '01/06/2026,GAS,40.00,',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.detectedMapping?.debit).toBe(2);
    expect(r.detectedMapping?.credit).toBe(3);
    expect(r.transactions).toEqual([
      { date: '2026-01-04', description: 'GROCERY', amount: -52.10 },
      { date: '2026-01-05', description: 'REFUND', amount: 12 },
      { date: '2026-01-06', description: 'GAS', amount: -40 },
    ]);
  });

  it('accepts an explicit mapping override (no header)', () => {
    const csv = [
      '2026-01-04,-4.75,STARBUCKS',
      '2026-01-05,2500.00,PAYROLL',
    ].join('\n');
    const r = parseCsv(csv, { mapping: { date: 0, amount: 1, description: 2 } });
    expect(r.transactions[0]).toEqual({ date: '2026-01-04', description: 'STARBUCKS', amount: -4.75 });
  });

  it('explicit mapping skips a leading header row if row 1 fails to parse', () => {
    const csv = [
      'When,How much,What', // header
      '2026-01-04,-4.75,STARBUCKS',
    ].join('\n');
    const r = parseCsv(csv, { mapping: { date: 0, amount: 1, description: 2 } });
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].description).toBe('STARBUCKS');
  });
});

describe('inspectCsv', () => {
  it('reports header detection + mapping for a normal file', () => {
    const csv = 'Date,Description,Amount\n2026-01-04,X,-1.00\n';
    const r = inspectCsv(csv);
    expect(r.hasHeader).toBe(true);
    expect(r.header).toEqual(['Date', 'Description', 'Amount']);
    expect(r.detectedMapping).toEqual({ date: 0, description: 1, amount: 2 });
    expect(r.delimiter).toBe(',');
  });

  it('reports no header for a headerless file', () => {
    const csv = '2026-01-04,X,-1.00\n2026-01-05,Y,-2.00\n';
    const r = inspectCsv(csv);
    expect(r.hasHeader).toBe(false);
    expect(r.header).toBeNull();
    expect(r.detectedMapping).not.toBeNull();
  });
});
