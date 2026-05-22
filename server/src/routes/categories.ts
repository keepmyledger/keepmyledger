import { Router, Request, Response } from 'express';

export function categoriesRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    res.json(await req.ctx!.repos.categories.findAll());
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const cat = await req.ctx!.repos.categories.findById(Number(req.params.id));
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    res.json(cat);
  });

  router.post('/', async (req: Request, res: Response) => {
    const { name, kind, taxExportCode } = req.body as Record<string, string | undefined>;
    if (!name || !kind) return res.status(400).json({ error: 'name and kind are required' });
    const cat = await req.ctx!.repos.categories.create({ name, kind: kind as never, taxExportCode: taxExportCode ?? null });
    res.status(201).json(cat);
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    const cat = await req.ctx!.repos.categories.update(Number(req.params.id), req.body);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    res.json(cat);
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const deleted = await req.ctx!.repos.categories.delete(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Category not found' });
    res.status(204).send();
  });

  return router;
}
