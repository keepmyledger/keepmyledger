import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { DriveService } from '../services/driveService';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function receiptsRouter(drive: DriveService): Router {
  const router = Router();

  // ── Per-user Google Drive auth ────────────────────────────────────────────

  /** GET /api/receipts/drive/status — is *this* user connected? */
  router.get('/drive/status', async (req, res) => {
    res.json({
      configured: drive.isConfigured(),
      authenticated: await drive.isAuthenticated(req.ctx!.userId),
    });
  });

  /** GET /api/receipts/drive/auth  — returns the Google OAuth URL */
  router.get('/drive/auth', (req, res) => {
    if (!drive.isConfigured()) {
      return res.status(503).json({ error: 'Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.' });
    }
    res.json({ url: drive.getAuthUrl(req.ctx!.userId) });
  });

  /** GET /api/receipts/drive/callback  — OAuth redirect target. The OAuth
   *  state param carries the userId set when the consent URL was generated;
   *  we cross-check it against the live session to prevent cross-account
   *  token attachment. */
  router.get('/drive/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code) return res.status(400).json({ error: 'Missing code parameter' });
    if (!state) return res.status(400).json({ error: 'Missing state parameter' });
    if (state !== req.ctx!.userId) {
      return res.status(403).json({ error: 'OAuth state does not match session user' });
    }
    try {
      await drive.handleCallback(state, code);
      res.redirect('/?driveConnected=1');
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Receipt records ───────────────────────────────────────────────────────

  router.get('/', async (req, res) => {
    res.json(await req.ctx!.repos.receipts.findAll());
  });

  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    if (!(await drive.isAuthenticated(req.ctx!.userId))) {
      return res.status(401).json({ error: 'Not authenticated with Google Drive' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    try {
      const driveData = await drive.uploadFile(req.ctx!.userId, req.file.buffer, req.file.originalname, req.file.mimetype);

      let receipt = await req.ctx!.repos.receipts.findByDriveFileId(driveData.driveFileId);
      if (!receipt) receipt = await req.ctx!.repos.receipts.create(driveData);

      const transactionId = req.body.transactionId ? Number(req.body.transactionId) : undefined;
      if (transactionId) {
        // Ensure the txn belongs to this user before linking.
        const tx = await req.ctx!.repos.transactions.findById(transactionId);
        if (!tx) return res.status(404).json({ error: 'Transaction not found' });
        await req.ctx!.repos.receipts.linkToTransaction(receipt.id, transactionId);
      }

      res.status(201).json(receipt);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/from-drive', async (req: Request, res: Response) => {
    const { driveFileId, driveFileName, driveMimeType, driveWebViewLink, driveThumbnailLink, transactionId } = req.body as {
      driveFileId: string;
      driveFileName: string;
      driveMimeType?: string;
      driveWebViewLink?: string;
      driveThumbnailLink?: string;
      transactionId?: number;
    };

    if (!driveFileId || !driveFileName) {
      return res.status(400).json({ error: 'driveFileId and driveFileName are required' });
    }

    let receipt = await req.ctx!.repos.receipts.findByDriveFileId(driveFileId);
    if (!receipt) {
      receipt = await req.ctx!.repos.receipts.create({ driveFileId, driveFileName, driveMimeType, driveWebViewLink, driveThumbnailLink });
    }

    if (transactionId) {
      const tx = await req.ctx!.repos.transactions.findById(Number(transactionId));
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      await req.ctx!.repos.receipts.linkToTransaction(receipt.id, Number(transactionId));
    }

    res.status(201).json(receipt);
  });

  router.delete('/:id', async (req, res) => {
    const ok = await req.ctx!.repos.receipts.deleteReceipt(Number(req.params.id));
    ok ? res.sendStatus(204) : res.status(404).json({ error: 'Receipt not found' });
  });

  // ── Transaction ↔ Receipt links ───────────────────────────────────────────

  router.get('/transactions/:txId', async (req, res) => {
    const txId = Number(req.params.txId);
    // Verify ownership of the transaction before exposing its receipts.
    const tx = await req.ctx!.repos.transactions.findById(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(await req.ctx!.repos.receipts.findByTransactionId(txId));
  });

  router.post('/transactions/:txId', async (req: Request, res: Response) => {
    const { receiptId } = req.body as { receiptId: number };
    if (!receiptId) return res.status(400).json({ error: 'receiptId is required' });
    const txId = Number(req.params.txId);
    const tx = await req.ctx!.repos.transactions.findById(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    // Verify the receipt belongs to the same user.
    const receipt = await req.ctx!.repos.receipts.findById(Number(receiptId));
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    await req.ctx!.repos.receipts.linkToTransaction(Number(receiptId), txId);
    res.json(await req.ctx!.repos.receipts.findByTransactionId(txId));
  });

  router.delete('/transactions/:txId/:receiptId', async (req, res) => {
    const txId = Number(req.params.txId);
    const receiptId = Number(req.params.receiptId);
    const tx = await req.ctx!.repos.transactions.findById(txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    await req.ctx!.repos.receipts.unlinkFromTransaction(receiptId, txId);
    res.sendStatus(204);
  });

  return router;
}
