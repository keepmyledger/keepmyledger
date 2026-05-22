import { Router, Request, Response } from 'express';

export function rulesRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    res.json(await req.ctx!.repos.rules.findAll());
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const rule = await req.ctx!.repos.rules.findById(Number(req.params.id));
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  router.post('/', async (req: Request, res: Response) => {
    const { name, descriptionPattern, patternKind, categoryId } = req.body as Record<string, unknown>;
    if (!name || !descriptionPattern || !categoryId) {
      return res.status(400).json({ error: 'name, descriptionPattern, and categoryId are required' });
    }
    const body = req.body as Record<string, unknown>;
    const rule = await req.ctx!.repos.rules.create({
      name: name as string,
      descriptionPattern: descriptionPattern as string,
      patternKind: (patternKind as never) ?? 'substring',
      amountMin: (body.amountMin as number) ?? null,
      amountMax: (body.amountMax as number) ?? null,
      accountId: (body.accountId as number) ?? null,
      categoryId: Number(categoryId),
      priority: Number(body.priority ?? 0),
    });
    res.status(201).json(rule);
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const rule = await req.ctx!.repos.rules.update(Number(req.params.id), req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const deleted = await req.ctx!.repos.rules.delete(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.status(204).send();
  });

  /** Re-apply this rule to all existing uncategorized/suggested transactions */
  router.post('/:id/apply', async (req: Request, res: Response) => {
    const rule = await req.ctx!.repos.rules.findById(Number(req.params.id));
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    await req.ctx!.services.categorization.reapplyRules(rule.id);
    res.json({ message: 'Rule applied to existing transactions' });
  });

  return router;
}
