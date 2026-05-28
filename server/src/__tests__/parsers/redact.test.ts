import { redactText } from '../../parsers/redact';

describe('parsers/redact', () => {
  describe('card numbers', () => {
    it('redacts 16-digit hyphen-formatted card numbers', () => {
      expect(redactText('Card: 1234-5678-9012-3456')).toBe('Card: XXXX-XXXX-XXXX-3456');
    });

    it('redacts 16-digit space-formatted card numbers', () => {
      expect(redactText('1234 5678 9012 3456')).toBe('XXXX XXXX XXXX 3456');
    });

    it('redacts 15-digit AmEx (4-6-5), keeping only last 4 visible', () => {
      // Industry convention: only last 4 are exposed, so the leading digit of
      // the 5-digit trailing group is masked too.
      expect(redactText('3782-822463-10005')).toBe('XXXX-XXXXXX-X0005');
    });

    it('redacts 14-digit Diners (4-6-4)', () => {
      expect(redactText('3056-930902-5904')).toBe('XXXX-XXXXXX-5904');
    });

    it('redacts unbroken 16-digit card numbers', () => {
      expect(redactText('Card 1234567890123456 charged')).toBe('Card XXXXXXXXXXXX3456 charged');
    });
  });

  describe('account / routing numbers', () => {
    it('redacts unbroken 12-digit account numbers', () => {
      expect(redactText('Acct 123456789012')).toBe('Acct XXXXXXXX9012');
    });

    it('redacts 9-digit routing numbers', () => {
      expect(redactText('Routing: 123456789')).toBe('Routing: XXXXX6789');
    });

    it('redacts 10-digit account numbers', () => {
      expect(redactText('Acct 1234567890')).toBe('Acct XXXXXX7890');
    });

    it('leaves 7-digit sequences alone (check numbers)', () => {
      expect(redactText('Check #1234567')).toBe('Check #1234567');
    });
  });

  describe('SSN', () => {
    it('redacts SSN with dashes', () => {
      expect(redactText('SSN 123-45-6789')).toBe('SSN XXX-XX-XXXX');
    });
  });

  describe('email / phone', () => {
    it('redacts email addresses', () => {
      expect(redactText('Contact alice@example.com today')).toBe('Contact [email] today');
    });

    it('redacts US phone numbers', () => {
      expect(redactText('Call 555-123-4567')).toBe('Call [phone]');
      expect(redactText('Call (555) 123-4567')).toBe('Call [phone]');
    });
  });

  describe('preserves transaction rows', () => {
    it('leaves dates, amounts, and descriptions intact', () => {
      const input = '05/12/2026  GROCERY STORE  45.67';
      expect(redactText(input)).toBe(input);
    });

    it('leaves dollar amounts alone', () => {
      expect(redactText('$1,234.56')).toBe('$1,234.56');
    });

    it('leaves 4-digit years alone', () => {
      expect(redactText('Statement for 2026')).toBe('Statement for 2026');
    });
  });
});
