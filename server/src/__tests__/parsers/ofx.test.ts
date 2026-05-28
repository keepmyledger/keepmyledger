import { parseOfx } from '../../parsers/ofx';

// ── OFX 1.x SGML fixture ──────────────────────────────────────────────────────

const OFX_1X_BANK = `
OFXHEADER:100
DATA:OFXSGML
VERSION:151
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260104120000
<TRNAMT>-4.75
<FITID>20260104-001
<NAME>STARBUCKS #123
<MEMO>Morning coffee
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260110
<TRNAMT>2500.00
<FITID>20260110-PAY
<NAME>PAYROLL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260115120000[-5:EST]
<TRNAMT>-1234.56
<FITID>20260115-002
<NAME>WHOLE FOODS
<MEMO>Grocery run
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim();

// OFX 2.x XML — same logical transactions
const OFX_2X_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260104120000</DTPOSTED>
            <TRNAMT>-4.75</TRNAMT>
            <FITID>20260104-001</FITID>
            <NAME>STARBUCKS #123</NAME>
            <MEMO>Morning coffee</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260110</DTPOSTED>
            <TRNAMT>2500.00</TRNAMT>
            <FITID>20260110-PAY</FITID>
            <NAME>PAYROLL</NAME>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260115120000</DTPOSTED>
            <TRNAMT>-1234.56</TRNAMT>
            <FITID>20260115-002</FITID>
            <NAME>WHOLE FOODS</NAME>
            <MEMO>Grocery run</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;

// QFX (OFX 1.x + Intuit-specific headers)
const QFX_BANK = `
OFXHEADER:100
DATA:OFXSGML
VERSION:151
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE
INTU.BID:00001
INTU.USERID:user@example.com

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260104
<TRNAMT>-12.00
<FITID>INTU-001
<NAME>AMAZON
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim();

// Credit card OFX — uses CCSTMTTRNRS / CCSTMTTRN in some emitters
const OFX_CC = `
OFXHEADER:100
DATA:OFXSGML
VERSION:151
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<BANKTRANLIST>
<CCSTMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260201
<TRNAMT>-55.00
<FITID>CC-001
<NAME>RESTAURANT XYZ
</CCSTMTTRN>
<CCSTMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260210
<TRNAMT>200.00
<FITID>CC-002
<NAME>PAYMENT THANK YOU
</CCSTMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>
`.trim();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseOfx', () => {
  describe('OFX 1.x (SGML)', () => {
    it('parses basic bank transactions with correct amounts and period', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.bankType).toBe('ofx');
      expect(r.parserUsed).toBe('ofx');
      expect(r.period).toBe('2026-01');
      expect(r.transactions).toHaveLength(3);
    });

    it('applies correct sign convention (negative=debit, positive=credit)', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[0].amount).toBe(-4.75);
      expect(r.transactions[1].amount).toBe(2500);
      expect(r.transactions[2].amount).toBe(-1234.56);
    });

    it('parses dates in YYYYMMDDHHMMSS format', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[0].date).toBe('2026-01-04');
    });

    it('parses dates in YYYYMMDD format', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[1].date).toBe('2026-01-10');
    });

    it('parses dates with timezone suffix YYYYMMDDHHMMSS[-5:EST]', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[2].date).toBe('2026-01-15');
    });

    it('appends FITID to description', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[0].description).toContain('[FITID:20260104-001]');
      expect(r.transactions[1].description).toContain('[FITID:20260110-PAY]');
    });

    it('joins NAME and MEMO with en-dash when memo differs from name', () => {
      const r = parseOfx(OFX_1X_BANK);
      expect(r.transactions[0].description).toMatch(/STARBUCKS #123 – Morning coffee/);
    });

    it('omits memo when it equals name (case-insensitive)', () => {
      const ofx = OFX_1X_BANK.replace('<MEMO>Morning coffee', '<MEMO>STARBUCKS #123');
      const r = parseOfx(ofx);
      expect(r.transactions[0].description).not.toContain('–');
      expect(r.transactions[0].description).toMatch(/^STARBUCKS #123/);
    });

    it('omits memo suffix entirely when there is no memo', () => {
      const r = parseOfx(OFX_1X_BANK);
      // PAYROLL has no MEMO
      expect(r.transactions[1].description).toMatch(/^PAYROLL/);
      expect(r.transactions[1].description).not.toContain('–');
    });
  });

  describe('OFX 2.x (XML)', () => {
    it('produces identical transactions to OFX 1.x for the same data', () => {
      const r1 = parseOfx(OFX_1X_BANK);
      const r2 = parseOfx(OFX_2X_XML);
      expect(r2.transactions).toEqual(r1.transactions);
    });

    it('sets bankType=ofx and parserUsed=ofx', () => {
      const r = parseOfx(OFX_2X_XML);
      expect(r.bankType).toBe('ofx');
      expect(r.parserUsed).toBe('ofx');
    });
  });

  describe('QFX (Intuit variant)', () => {
    it('ignores Intuit-specific header lines and parses normally', () => {
      const r = parseOfx(QFX_BANK);
      expect(r.transactions).toHaveLength(1);
      expect(r.transactions[0].amount).toBe(-12);
      expect(r.transactions[0].description).toMatch(/AMAZON/);
      expect(r.transactions[0].description).toContain('[FITID:INTU-001]');
    });
  });

  describe('credit card (CCSTMTTRN)', () => {
    it('parses CCSTMTTRN blocks without flipping signs', () => {
      const r = parseOfx(OFX_CC);
      expect(r.transactions).toHaveLength(2);
      // Charge: negative as-emitted by bank (debit from credit-card perspective)
      expect(r.transactions[0].amount).toBe(-55);
      // Payment: positive as-emitted
      expect(r.transactions[1].amount).toBe(200);
    });
  });

  describe('missing FITID', () => {
    it('description has no [FITID:] suffix when FITID is absent', () => {
      const ofx = OFX_1X_BANK.replace(/<FITID>20260104-001\n/, '');
      const r = parseOfx(ofx);
      expect(r.transactions[0].description).not.toContain('[FITID:');
    });
  });

  describe('empty transaction list', () => {
    it('throws when no transactions are found', () => {
      const ofx = `OFXHEADER:100\n\n<OFX>\n<BANKMSGSRSV1>\n</BANKMSGSRSV1>\n</OFX>`;
      expect(() => parseOfx(ofx)).toThrow('No transactions found in OFX file');
    });
  });
});
