import { Transaction, Rule } from '@keepmyledger/shared';
import { RuleRepo } from '../repos/RuleRepo';
import { TransactionRepo } from '../repos/TransactionRepo';
import { CategoryRepo } from '../repos/CategoryRepo';

export class CategorizationService {
  constructor(
    private ruleRepo: RuleRepo,
    private txRepo: TransactionRepo,
    private categoryRepo: CategoryRepo
  ) {}

  /**
   * Categorize a single transaction in place (updates DB).
   * 1. Try rules in priority order.
   * 2. Fall back to history heuristic → mark as "suggested".
   *
   * Never overwrites a `manual` category — the user is the source of truth.
   */
  async categorize(tx: Transaction): Promise<void> {
    if (tx.categorySource === 'manual') return;

    const rules = await this.ruleRepo.findOrdered();
    const matchedRule = this.findMatchingRule(tx, rules);

    if (matchedRule) {
      const update: { categoryId: number; categorySource: 'rule'; taxDescription?: string | null } = {
        categoryId: matchedRule.categoryId,
        categorySource: 'rule',
      };
      // Apply rule's tax description only if the transaction doesn't already have one
      if (matchedRule.taxDescription && !tx.taxDescription) {
        update.taxDescription = matchedRule.taxDescription;
      }
      await this.txRepo.update(tx.id, update);
      await this.txRepo.setRuleId(tx.id, matchedRule.id);
      return;
    }

    const suggested = await this.suggestFromHistory(tx);
    if (suggested !== null) {
      await this.txRepo.update(tx.id, {
        categoryId: null,
        categorySource: 'suggested',
      });
      await this.txRepo.setSuggestedCategoryId(tx.id, suggested);
    }
  }

  /** Categorize all transactions for a statement. */
  async categorizeAll(transactions: Transaction[]): Promise<void> {
    for (const tx of transactions) {
      await this.categorize(tx);
    }
  }

  /**
   * Re-apply rules to transactions.
   * - If `ruleId` given: apply only that one rule to all non-manual transactions.
   * - Otherwise: re-run the full rule engine over uncategorized/suggested rows.
   * Manual categorizations are never overwritten.
   */
  async reapplyRules(ruleId?: number): Promise<void> {
    if (ruleId !== undefined) {
      const rule = await this.ruleRepo.findById(ruleId);
      if (!rule) return;
      const all = await this.txRepo.findAll();
      const candidates = all.filter((t) => t.categorySource !== 'manual');
      for (const tx of candidates) {
        if (this.findMatchingRule(tx, [rule]) === rule) {
          const update: { categoryId: number; categorySource: 'rule'; taxDescription?: string | null } = {
            categoryId: rule.categoryId,
            categorySource: 'rule',
          };
          if (rule.taxDescription && !tx.taxDescription) {
            update.taxDescription = rule.taxDescription;
          }
          await this.txRepo.update(tx.id, update);
          await this.txRepo.setRuleId(tx.id, rule.id);
        }
      }
      return;
    }
    const txs = await this.txRepo.findAll({ uncategorized: true });
    for (const tx of txs) await this.categorize(tx);
  }

  private findMatchingRule(tx: Transaction, rules: Rule[]): Rule | null {
    for (const rule of rules) {
      // Account scope filter
      if (rule.accountId !== null && rule.accountId !== tx.accountId) continue;

      // Amount range filter
      if (rule.amountMin !== null && tx.amount < rule.amountMin) continue;
      if (rule.amountMax !== null && tx.amount > rule.amountMax) continue;

      // Pattern match
      if (rule.patternKind === 'regex') {
        try {
          if (!new RegExp(rule.descriptionPattern, 'i').test(tx.description)) continue;
        } catch {
          continue; // Invalid regex in rule — skip
        }
      } else {
        // substring
        if (!tx.description.toLowerCase().includes(rule.descriptionPattern.toLowerCase())) continue;
      }

      return rule;
    }
    return null;
  }

  /**
   * History heuristic: find a prior manually or rule-assigned transaction
   * whose description shares the longest common token with this one.
   * Returns the suggested categoryId or null.
   */
  private async suggestFromHistory(tx: Transaction): Promise<number | null> {
    const tokens = tokenize(tx.description);
    if (tokens.size === 0) return null;

    // Pull all confirmed categorized transactions (rule or manual)
    const all = await this.txRepo.findAll();
    const past = all.filter(
      (t) =>
        t.id !== tx.id &&
        t.categoryId !== null &&
        (t.categorySource === 'rule' || t.categorySource === 'manual')
    );

    let bestCategoryId: number | null = null;
    let bestScore = 0;

    for (const past_tx of past) {
      const pastTokens = tokenize(past_tx.description);
      const score = jaccardSimilarity(tokens, pastTokens);
      if (score > bestScore && score >= 0.4) {
        // 40% token overlap threshold
        bestScore = score;
        bestCategoryId = past_tx.categoryId;
      }
    }

    return bestCategoryId;
  }
}

function tokenize(description: string): Set<string> {
  return new Set(
    description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2) // skip short tokens like "at", "in"
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}
