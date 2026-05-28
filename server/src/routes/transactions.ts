import { Router, Request, Response } from 'express';
import { TransactionFilter } from '../repos/TransactionRepo';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription';
import { getAiQuota } from '../services/tierService';

export function transactionsRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const filter: TransactionFilter = {};
    if (q.accountId) filter.accountId = Number(q.accountId);
    if (q.statementId) filter.statementId = Number(q.statementId);
    if (q.dateFrom) filter.dateFrom = q.dateFrom;
    if (q.dateTo) filter.dateTo = q.dateTo;
    if (q.categorySource) filter.categorySource = q.categorySource;
    if (q.hasReceipts !== undefined) filter.hasReceipts = q.hasReceipts === 'true';
    if (q.uncategorized === 'true') filter.uncategorized = true;
    res.json(await req.ctx!.repos.transactions.findAll(filter));
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const tx = await req.ctx!.repos.transactions.findById(Number(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.date !== undefined) {
      if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
    }
    if (body.description !== undefined) {
      if (typeof body.description !== 'string' || body.description.trim() === '') {
        return res.status(400).json({ error: 'description must be a non-empty string' });
      }
      body.description = (body.description as string).trim();
    }
    if (body.amount !== undefined) {
      const n = typeof body.amount === 'number' ? body.amount : Number(body.amount);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ error: 'amount must be a finite number' });
      }
      body.amount = Math.round(n * 100) / 100;
    }
    const tx = await req.ctx!.repos.transactions.update(Number(req.params.id), body);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  });

  /** Approve a suggested category (promotes suggested → manual) */
  router.post('/:id/approve-suggestion', async (req: Request, res: Response) => {
    const tx = await req.ctx!.repos.transactions.findById(Number(req.params.id));
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.categorySource !== 'suggested' || tx.suggestedCategoryId === null) {
      return res.status(400).json({ error: 'Transaction does not have a pending suggestion' });
    }
    const updated = await req.ctx!.repos.transactions.update(tx.id, {
      categoryId: tx.suggestedCategoryId,
      categorySource: 'manual',
    });
    res.json(updated);
  });

  /** Ask the LLM to suggest a category + tax description + optional rule. */
  router.post('/:id/ai-suggest', requireActiveSubscription(), async (req: Request, res: Response) => {
    const ai = req.ctx!.services.aiAssist;
    if (!ai.isAvailable()) {
      return res.status(503).json({ error: 'AI assist is not configured. Set LLM_API_KEY on the server.' });
    }

    // Resolve quota by subscription tier:
    //   free   → lifetime cap (5 calls total)
    //   paid   → daily cap from AI_DAILY_LIMIT (0 = unlimited)
    //   self-host → unlimited
    const sub = await req.ctx!.repos.subscription.get();
    const quota = getAiQuota(sub);
    const usageRepo = req.ctx!.repos.aiUsage;

    if (quota.kind === 'lifetime') {
      const used = await usageRepo.getLifetimeCount();
      if (used >= quota.limit) {
        return res.status(429).json({
          error: `Free trial AI Assist limit reached (${used}/${quota.limit}). Upgrade for unlimited AI Assist.`,
          limit: quota.limit,
          used,
          period: 'lifetime',
          upgradeRequired: true,
        });
      }
    } else if (quota.kind === 'daily') {
      const used = await usageRepo.getTodayCount();
      if (used >= quota.limit) {
        res.setHeader('Retry-After', secondsUntilUtcMidnight());
        return res.status(429).json({
          error: `Daily AI Assist limit reached (${used}/${quota.limit}). Resets at 00:00 UTC.`,
          limit: quota.limit,
          used,
          period: 'daily',
          resetAt: nextUtcMidnight().toISOString(),
        });
      }
    }

    try {
      const suggestion = await ai.suggest(Number(req.params.id));
      // Only count successful calls toward the quota. Increment unconditionally
      // for free + daily quotas (lifetime sums all daily rows anyway).
      if (quota.kind !== 'unlimited') {
        await usageRepo.incrementToday();
      }
      res.json(suggestion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg === 'Transaction not found' ? 404 : 502;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const deleted = await req.ctx!.repos.transactions.delete(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Transaction not found' });
    res.status(204).send();
  });

  /** Bulk delete: DELETE /api/transactions  body: { ids: number[] } */
  router.delete('/', async (req: Request, res: Response) => {
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const numeric = (ids as unknown[]).map(Number);
    if (numeric.some((n) => !Number.isFinite(n) || n !== Math.floor(n) || n <= 0)) {
      return res.status(400).json({ error: 'All ids must be positive integers' });
    }
    const deleted = await req.ctx!.repos.transactions.bulkDelete(numeric);
    res.json({ deleted });
  });

  /** GET /api/transactions/:id/splits: return all splits for a transaction */
  router.get('/:id/splits', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const tx = await req.ctx!.repos.transactions.findById(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    const splits = await req.ctx!.repos.transactions.getSplits(id);
    res.json({ splits });
  });

  /**
   * PUT /api/transactions/:id/splits: atomically replace all splits.
   * Body: { splits: Array<{ categoryId: number; amount: number; note?: string }> }
   * Pass an empty array to clear splits.
   * Validates that split amounts sum to the parent transaction amount (±$0.01 tolerance).
   */
  router.put('/:id/splits', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const tx = await req.ctx!.repos.transactions.findById(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const { splits } = (req.body ?? {}) as { splits?: unknown };
    if (!Array.isArray(splits)) {
      return res.status(400).json({ error: 'splits must be an array' });
    }

    type SplitInput = { categoryId: number; amount: number; note?: string | null };
    const parsed: SplitInput[] = [];
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i] as Record<string, unknown>;
      const catId = Number(s.categoryId);
      const amt = Number(s.amount);
      if (!Number.isFinite(catId) || catId <= 0) {
        return res.status(400).json({ error: `splits[${i}].categoryId must be a positive integer` });
      }
      if (!Number.isFinite(amt) || amt === 0) {
        return res.status(400).json({ error: `splits[${i}].amount must be a nonzero number` });
      }
      parsed.push({ categoryId: catId, amount: Math.round(amt * 100) / 100, note: (s.note as string | null) ?? null });
    }

    if (parsed.length > 0) {
      const splitTotal = parsed.reduce((acc, s) => acc + s.amount, 0);
      if (Math.abs(splitTotal - tx.amount) > 0.01) {
        return res.status(400).json({
          error: `Split amounts (${splitTotal.toFixed(2)}) must sum to the transaction amount (${tx.amount.toFixed(2)})`,
        });
      }
    }

    const saved = await req.ctx!.repos.transactions.replaceSplits(id, parsed);
    res.json({ splits: saved });
  });

  return router;
}

function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0,
  ));
}

function secondsUntilUtcMidnight(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((nextUtcMidnight(now).getTime() - now.getTime()) / 1000));
}
