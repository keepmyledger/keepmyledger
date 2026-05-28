import { Router, Request, Response } from 'express';
import { CategoryKind } from '@keepmyledger/shared';
import { TransactionFilter } from '../repos/TransactionRepo';

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportsRouter(): Router {
  const router = Router();

  router.get('/by-category', async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await req.ctx!.repos.transactions.reportByCategory(year));
  });

  router.get('/cashflow', async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    res.json(await req.ctx!.repos.transactions.reportCashflow(year));
  });

  return router;
}

export function startupRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    res.json(await req.ctx!.services.tracking.getMissingPriorMonth());
  });

  return router;
}

export function exportsRouter(): Router {
  const router = Router();

  router.get('/tax', async (req: Request, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const rows = await req.ctx!.repos.transactions.reportByCategory(year);

    const lines: string[] = ['Tax Export Code,Category,Kind,Total'];
    for (const row of rows) {
      const code = row.categoryId
        ? ((await req.ctx!.repos.categories.findById(row.categoryId))?.taxExportCode ?? '')
        : '';
      lines.push([
        `"${code}"`,
        `"${row.categoryName ?? 'Uncategorized'}"`,
        `"${row.kind ?? ''}"`,
        row.total.toFixed(2),
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tax-export${year ? `-${year}` : ''}.csv"`);
    res.send(lines.join('\n'));
  });

  router.get('/transactions', async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const filter: TransactionFilter = {};
    if (q.accountId) filter.accountId = Number(q.accountId);
    if (q.statementId) filter.statementId = Number(q.statementId);
    if (q.dateFrom) filter.dateFrom = q.dateFrom;
    if (q.dateTo) filter.dateTo = q.dateTo;
    if (q.categorySource) filter.categorySource = q.categorySource;
    if (q.hasReceipts !== undefined) filter.hasReceipts = q.hasReceipts === 'true';
    if (q.uncategorized === 'true') filter.uncategorized = true;
    if (q.kind === 'expense' || q.kind === 'income' || q.kind === 'transfer') {
      filter.kind = q.kind as CategoryKind;
    }

    const repos = req.ctx!.repos;
    const txs = await repos.transactions.findAll(filter);
    const accounts = new Map((await repos.accounts.findAll()).map((a) => [a.id, a]));
    const categories = new Map((await repos.categories.findAll()).map((c) => [c.id, c]));

    const header = [
      'Date', 'Account', 'Description', 'Amount',
      'Category', 'Category Kind', 'Tax Export Code',
      'Source', 'Tax Description', 'Notes', 'Receipts',
    ];
    const lines: string[] = [header.join(',')];

    for (const tx of txs) {
      const acct = accounts.get(tx.accountId);
      const cat = tx.categoryId != null ? categories.get(tx.categoryId) : null;
      const txReceipts = await repos.receipts.findByTransactionId(tx.id);
      const receipts = txReceipts.map((r) => r.driveFileName ?? r.originalFilename ?? `receipt-${r.id}`).join('; ');
      lines.push([
        csvEscape(tx.date),
        csvEscape(acct?.name ?? ''),
        csvEscape(tx.description),
        tx.amount.toFixed(2),
        csvEscape(cat?.name ?? ''),
        csvEscape(cat?.kind ?? ''),
        csvEscape(cat?.taxExportCode ?? ''),
        csvEscape(tx.categorySource ?? ''),
        csvEscape(tx.taxDescription ?? ''),
        csvEscape(tx.notes ?? ''),
        csvEscape(receipts),
      ].join(','));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const kindSuffix = filter.kind ? `-${filter.kind}` : '';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions${kindSuffix}-${stamp}.csv"`);
    res.send(lines.join('\n'));
  });

  return router;
}
