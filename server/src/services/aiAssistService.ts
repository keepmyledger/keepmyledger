import { AiSuggestion, ProposedRule, Transaction, Category, Rule, PatternKind } from '@keepmyledger/shared';
import { chatJson, isLlmConfigured } from '../llm/client';
import { TransactionRepo } from '../repos/TransactionRepo';
import { CategoryRepo } from '../repos/CategoryRepo';
import { RuleRepo } from '../repos/RuleRepo';
import { AccountRepo } from '../repos/AccountRepo';

const SYSTEM_PROMPT = `You are a financial categorization assistant for a personal/small-business
expense tracker for KeepMyLedger. Given a single transaction and the user's category list (plus
recent context), pick the best category, suggest an audit-friendly tax
description if relevant, and optionally propose a reusable rule.

Return ONLY valid JSON matching this schema (no markdown, no extra text):
{
  "categoryId": <number from the provided category list, or null if unsure>,
  "confidence": <number from 0 to 1>,
  "taxDescription": <short string describing business purpose, or null>,
  "rationale": <one-sentence explanation, or null>,
  "proposedRule": <null OR an object {
    "name": "Short rule name",
    "descriptionPattern": "substring to match (use the merchant's stable name fragment)",
    "patternKind": "substring",
    "categoryId": <same number as above>,
    "taxDescription": <same as taxDescription or null>
  }>
}

Rules for proposing a rule:
- Only propose a rule when the merchant is recognizable and likely to recur
  (e.g. "STARBUCKS", "AWS", "UBER"). Do NOT propose rules for one-off purchases,
  bank fees with unique IDs, or person-to-person transfers.
- descriptionPattern should be a stable substring of the transaction description
  that uniquely identifies this merchant — avoid dates, transaction IDs, or
  reference numbers.
- patternKind must be "substring".
- Skip the proposedRule if a similar rule already exists (you'll be told which
  rules the user already has).

Confidence guidance:
- 0.9+ for obvious recurring merchants matching one clear category.
- 0.6–0.8 for plausible but uncertain.
- <0.5 means the user should manually review; do not propose a rule.

If no category fits well, return categoryId: null and confidence < 0.4.`;

export interface AiAssistDeps {
  transactions: TransactionRepo;
  categories: CategoryRepo;
  rules: RuleRepo;
  accounts: AccountRepo;
}

export class AiAssistService {
  constructor(private deps: AiAssistDeps) {}

  isAvailable(): boolean {
    return isLlmConfigured();
  }

  async suggest(transactionId: number): Promise<AiSuggestion> {
    if (!this.isAvailable()) {
      throw new Error('AI assist is not configured (set LLM_API_KEY).');
    }

    const tx = await this.deps.transactions.findById(transactionId);
    if (!tx) throw new Error('Transaction not found');

    const categories = await this.deps.categories.findAll();
    const rules = await this.deps.rules.findAll();
    const account = await this.deps.accounts.findById(tx.accountId);

    const userPrompt = buildUserPrompt(tx, categories, rules, account?.name ?? 'Unknown');

    const raw = await chatJson<RawSuggestion>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 600,
    });

    return validate(raw, categories);
  }
}

interface RawSuggestion {
  categoryId: number | null;
  confidence: number;
  taxDescription: string | null;
  rationale: string | null;
  proposedRule: {
    name?: string;
    descriptionPattern?: string;
    patternKind?: string;
    categoryId?: number;
    taxDescription?: string | null;
  } | null;
}

function buildUserPrompt(tx: Transaction, categories: Category[], rules: Rule[], accountName: string): string {
  const categoryList = categories
    .map((c) => `  ${c.id}: ${c.name} (${c.kind}${c.taxExportCode ? `, ${c.taxExportCode}` : ''})`)
    .join('\n');

  const existingPatterns = rules
    .map((r) => `  - "${r.descriptionPattern}" → category ${r.categoryId}`)
    .slice(0, 30)
    .join('\n');

  return [
    `Transaction:`,
    `  Date: ${tx.date}`,
    `  Description: ${tx.description}`,
    `  Amount: ${tx.amount.toFixed(2)} (${tx.amount < 0 ? 'expense/charge' : 'income/credit'})`,
    `  Account: ${accountName}`,
    ``,
    `Available categories (use only these IDs):`,
    categoryList,
    ``,
    `Existing rules (do NOT propose a duplicate):`,
    existingPatterns || '  (none)',
    ``,
    `Return JSON only.`,
  ].join('\n');
}

function validate(raw: RawSuggestion, categories: Category[]): AiSuggestion {
  const validIds = new Set(categories.map((c) => c.id));
  const categoryId = raw.categoryId != null && validIds.has(raw.categoryId) ? raw.categoryId : null;
  const categoryName = categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? null) : null;

  const confidence = clamp01(Number(raw.confidence) || 0);

  let proposedRule: ProposedRule | null = null;
  const pr = raw.proposedRule;
  if (pr && categoryId && confidence >= 0.5 && pr.descriptionPattern && pr.name) {
    const patternKind: PatternKind = pr.patternKind === 'regex' ? 'regex' : 'substring';
    proposedRule = {
      name: String(pr.name).slice(0, 100),
      descriptionPattern: String(pr.descriptionPattern).slice(0, 200),
      patternKind,
      categoryId,
      taxDescription: pr.taxDescription ? String(pr.taxDescription).slice(0, 500) : null,
    };
  }

  return {
    categoryId,
    categoryName,
    confidence,
    taxDescription: raw.taxDescription ? String(raw.taxDescription).slice(0, 500) : null,
    rationale: raw.rationale ? String(raw.rationale).slice(0, 500) : null,
    proposedRule,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
