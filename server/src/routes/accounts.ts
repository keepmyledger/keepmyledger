import { Router, Request, Response } from 'express';

export function accountsRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    res.json(await req.ctx!.repos.accounts.findAll());
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const account = await req.ctx!.repos.accounts.findById(Number(req.params.id));
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);
  });

  router.post('/', async (req: Request, res: Response) => {
    const { name, bankType, accountKind } = req.body as Record<string, string>;
    if (!name || !bankType || !accountKind) {
      return res.status(400).json({ error: 'name, bankType, and accountKind are required' });
    }
    const account = await req.ctx!.repos.accounts.create({ name, bankType: bankType as never, accountKind: accountKind as never });
    res.status(201).json(account);
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const { name, bankType, accountKind, csvMapping } = req.body as Record<string, unknown>;
    const account = await req.ctx!.repos.accounts.update(Number(req.params.id), { name, bankType, accountKind, csvMapping } as never);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const deleted = await req.ctx!.repos.accounts.delete(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Account not found' });
    res.status(204).send();
  });

  return router;
}
