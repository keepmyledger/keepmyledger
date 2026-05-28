/**
 * LLM parser tests — covers the parser hardening shipped in issue #42:
 * - Sign-convention rule injection by accountKind
 * - Defensive output validator (drops hallucinated fields)
 * - Auto-retry with clarification on low confidence
 *
 * The OpenAI client is mocked so no network calls happen and we can drive
 * the LLM response shape from each test.
 */

type ChatCreate = (args: { messages: Array<{ role: string; content: string }> }) => Promise<{
  choices: Array<{ message: { content: string } }>;
}>;

const mockCreate = jest.fn() as jest.MockedFunction<ChatCreate>;

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

import { llmParser } from '../../parsers/llm';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockCreate.mockReset();
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, LLM_API_KEY: 'test-key' };
  // Reset the module-level client cache between tests
  (llmParser as unknown as { client: null | unknown }).client = null;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const goodBankResponse = JSON.stringify({
  bankName: 'Chase',
  period: '2026-01',
  transactions: [
    { date: '2026-01-04', description: 'STARBUCKS', amount: -4.75 },
    { date: '2026-01-10', description: 'PAYROLL', amount: 2500 },
    { date: '2026-01-15', description: 'WHOLE FOODS', amount: -120.34 },
  ],
});

const queueResponse = (content: string) => {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
};

describe('llmParser.parse', () => {
  describe('sign-convention prompt injection', () => {
    it('appends credit-card sign rule when accountKind is credit_card', async () => {
      queueResponse(goodBankResponse);
      await llmParser.parse('statement text', 'credit_card');
      const call = mockCreate.mock.calls[0][0];
      const system = call.messages.find((m) => m.role === 'system')?.content ?? '';
      expect(system).toMatch(/credit card statement/i);
      expect(system).toMatch(/charges and purchases must be NEGATIVE/);
    });

    it('appends bank-account sign rule when accountKind is checking', async () => {
      queueResponse(goodBankResponse);
      await llmParser.parse('statement text', 'checking');
      const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system')?.content ?? '';
      expect(system).toMatch(/bank account statement/i);
      expect(system).toMatch(/withdrawals and expenses must be NEGATIVE/);
    });

    it('does not append any sign rule when accountKind is undefined', async () => {
      queueResponse(goodBankResponse);
      await llmParser.parse('statement text');
      const system = mockCreate.mock.calls[0][0].messages.find((m) => m.role === 'system')?.content ?? '';
      expect(system).not.toMatch(/credit card statement/i);
      expect(system).not.toMatch(/bank account statement/i);
    });
  });

  describe('sign-convention scoring', () => {
    it('penalizes confidence when credit-card statement has mostly positive amounts', async () => {
      const reversed = JSON.stringify({
        bankName: 'Visa',
        period: '2026-01',
        transactions: [
          { date: '2026-01-04', description: 'STARBUCKS', amount: 4.75 },
          { date: '2026-01-05', description: 'GAS', amount: 40 },
          { date: '2026-01-06', description: 'GROCERIES', amount: 120 },
          { date: '2026-01-07', description: 'PAYMENT', amount: -200 },
        ],
      });
      queueResponse(reversed);
      // Queue a second response in case retry fires (mostly positives → low confidence)
      queueResponse(reversed);
      const result = await llmParser.parse('statement text', 'credit_card');
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([expect.stringMatching(/sign convention may be reversed/)]),
      );
      expect(result.confidence ?? 1).toBeLessThan(1);
    });

    it('does not penalize a credit-card statement with mostly negative amounts', async () => {
      queueResponse(goodBankResponse);
      const result = await llmParser.parse('statement text', 'credit_card');
      const signWarn = (result.warnings ?? []).find((w) => /sign convention/.test(w));
      expect(signWarn).toBeUndefined();
    });
  });

  describe('defensive output validator', () => {
    it('drops hallucinated categoryId fields from LLM output', async () => {
      const hallucinated = JSON.stringify({
        bankName: 'Chase',
        period: '2026-01',
        transactions: [
          { date: '2026-01-04', description: 'STARBUCKS', amount: -4.75, categoryId: 9999, category: 'Food' },
        ],
      });
      queueResponse(hallucinated);
      const result = await llmParser.parse('statement text');
      const tx = result.transactions[0];
      expect(tx).toEqual({ date: '2026-01-04', description: 'STARBUCKS', amount: -4.75 });
      expect((tx as unknown as Record<string, unknown>).categoryId).toBeUndefined();
      expect((tx as unknown as Record<string, unknown>).category).toBeUndefined();
    });

    it('handles missing fields gracefully (no crash on undefined description)', async () => {
      const malformed = JSON.stringify({
        bankName: 'Chase',
        period: '2026-01',
        transactions: [{ date: '2026-01-04', amount: -4.75 }],
      });
      queueResponse(malformed);
      queueResponse(malformed); // for potential retry
      const result = await llmParser.parse('statement text');
      expect(result.transactions[0].description).toBe('');
    });
  });

  describe('auto-retry on low confidence', () => {
    it('fires a second attempt when first result has low confidence and warnings', async () => {
      // First attempt: empty transactions → confidence 0, warnings present
      queueResponse(JSON.stringify({ bankName: 'unknown', period: '2026-01', transactions: [] }));
      // Second attempt: good data
      queueResponse(goodBankResponse);

      const result = await llmParser.parse('statement text');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.transactions.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('does not retry when first result is high confidence', async () => {
      queueResponse(goodBankResponse);
      const result = await llmParser.parse('statement text');
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('returns the better of the two attempts when retry fires', async () => {
      // First attempt: zero transactions → confidence 0
      queueResponse(JSON.stringify({ bankName: 'unknown', period: '2026-01', transactions: [] }));
      // Second attempt: also zero transactions → confidence 0
      queueResponse(JSON.stringify({ bankName: 'unknown', period: '2026-01', transactions: [] }));

      const result = await llmParser.parse('statement text');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      // Both are equally bad — the first is returned (second isn't strictly greater)
      expect(result.confidence).toBe(0);
    });

    it('passes the clarifying message to the retry attempt', async () => {
      queueResponse(JSON.stringify({ bankName: 'unknown', period: '2026-01', transactions: [] }));
      queueResponse(goodBankResponse);

      await llmParser.parse('original statement text');
      const retryCall = mockCreate.mock.calls[1][0];
      const userMsg = retryCall.messages.find((m) => m.role === 'user')?.content ?? '';
      expect(userMsg).toContain('original statement text');
      expect(userMsg).toMatch(/previous parse had these issues/i);
    });
  });
});
