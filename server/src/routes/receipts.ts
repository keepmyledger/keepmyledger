import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import type { ReceiptStoragePreference } from '@keepmyledger/shared';
import type { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';
import type { DriveService } from '../services/driveService';
import type { Storage } from '../services/storage/Storage';
import { validateReceiptUpload } from '../services/storage/uploadValidation';
import { getDefaultReceiptStorage } from '../services/storage/preference';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const SIGNED_URL_TTL_SEC = 10 * 60; // 10 minutes

export interface ReceiptsRouterDeps {
  db: DbAdapter;
  drive: DriveService;
  /** S3-compatible object storage. Active per-user when configured + the user prefers KML. */
  storage?: Storage | null;
}

/**
 * Resolve which backend a given user uploads to *right now*. Honours an explicit
 * user preference; otherwise falls back to the server default. Returns 'drive'
 * whenever S3 is not configured, even if the user prefers KML — the UI guards
 * this, but the route is defence in depth.
 */
function resolveBackend(
  userPref: ReceiptStoragePreference | null | undefined,
  storage: Storage | null | undefined,
): ReceiptStoragePreference {
  const wanted = userPref ?? getDefaultReceiptStorage(Boolean(storage));
  if (wanted === 'kml' && !storage) return 'drive';
  return wanted;
}

export function receiptsRouter({ db, drive, storage = null }: ReceiptsRouterDeps): Router {
  const userRepo = getUserRepo(db);
  const router = Router();

  // ── Per-user Google Drive auth ────────────────────────────────────────────

  /** GET /api/receipts/drive/status: is *this* user connected? */
  router.get('/drive/status', async (req, res) => {
    res.json({
      configured: drive.isConfigured(),
      authenticated: await drive.isAuthenticated(req.ctx!.userId),
    });
  });

  /** GET /api/receipts/drive/auth: returns the Google OAuth URL */
  router.get('/drive/auth', (req, res) => {
    if (!drive.isConfigured()) {
      return res.status(503).json({ error: 'Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.' });
    }
    res.json({ url: drive.getAuthUrl(req.ctx!.userId) });
  });

  /** GET /api/receipts/drive/callback: OAuth redirect target. The OAuth
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

  /**
   * GET /api/receipts/:id/download → 302 to a short-lived signed URL.
   * Only valid for S3-backed receipts (Drive receipts have driveWebViewLink).
   */
  router.get('/:id/download', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid receipt id' });
    const receipt = await req.ctx!.repos.receipts.findById(id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    if (receipt.storageBackend !== 's3' || !receipt.storageKey) {
      return res.status(400).json({ error: 'Receipt is not S3-backed' });
    }
    if (!storage) return res.status(503).json({ error: 'S3 storage is not configured' });
    const url = await storage.getSignedUrl(receipt.storageKey, SIGNED_URL_TTL_SEC);
    res.redirect(url);
  });

  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    try {
      const transactionId = req.body.transactionId ? Number(req.body.transactionId) : undefined;
      if (transactionId) {
        const tx = await req.ctx!.repos.transactions.findById(transactionId);
        if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      }

      const user = await userRepo.findById(req.ctx!.userId);
      const backend = resolveBackend(user?.receiptStoragePreference, storage);

      let receipt;
      if (backend === 'kml' && storage) {
        const info = validateReceiptUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
        const key = `receipts/${req.ctx!.businessId}/${randomUUID()}.${info.ext}`;
        await storage.put(key, req.file.buffer, info.contentType);
        receipt = await req.ctx!.repos.receipts.createFromS3({
          storageKey: key,
          originalFilename: req.file.originalname,
          contentType: info.contentType,
          sizeBytes: req.file.buffer.length,
        });
      } else {
        if (!(await drive.isAuthenticated(req.ctx!.userId))) {
          return res.status(401).json({ error: 'Not authenticated with Google Drive' });
        }
        const driveData = await drive.uploadFile(req.ctx!.userId, req.file.buffer, req.file.originalname, req.file.mimetype);
        const existing = await req.ctx!.repos.receipts.findByDriveFileId(driveData.driveFileId);
        receipt = existing ?? await req.ctx!.repos.receipts.create(driveData);
      }

      if (transactionId) await req.ctx!.repos.receipts.linkToTransaction(receipt.id, transactionId);
      res.status(201).json(receipt);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
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
    const id = Number(req.params.id);
    const receipt = await req.ctx!.repos.receipts.findById(id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

    // Best-effort cleanup of the S3 object. Drive uploads remain in the user's
    // Drive — we don't currently have permission to delete them from here.
    if (receipt.storageBackend === 's3' && receipt.storageKey && storage) {
      try { await storage.delete(receipt.storageKey); }
      catch (err) { console.error('[receipts] failed to delete S3 object', receipt.storageKey, err); }
    }

    const ok = await req.ctx!.repos.receipts.deleteReceipt(id);
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
