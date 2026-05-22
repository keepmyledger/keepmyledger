import { Router, Request, Response } from 'express';
import { TransactionFilter } from '../repos/TransactionRepo';
import { getAiDailyLimit } from '../auth/context';

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
  router.post('/:id/ai-suggest', async (req: Request, res: Response) => {
    const ai = req.ctx!.services.aiAssist;
    if (!ai.isAvailable()) {
      return res.status(503).json({ error: 'AI assist is not configured. Set LLM_API_KEY on the server.' });
    }

    // Per-user daily quota. limit=0 means unlimited.
    const limit = getAiDailyLimit();
    const usageRepo = req.ctx!.repos.aiUsage;
    if (limit > 0) {
      const used = await usageRepo.getTodayCount();
      if (used >= limit) {
        res.setHeader('Retry-After', secondsUntilUtcMidnight());
        return res.status(429).json({
          error: `Daily AI Assist limit reached (${used}/${limit}). Resets at 00:00 UTC.`,
          limit,
          used,
          resetAt: nextUtcMidnight().toISOString(),
        });
      }
    }

    try {
      const suggestion = await ai.suggest(Number(req.params.id));
      // Only count successful calls toward the quota.
      if (limit > 0) {
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
