import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireOrgOwner } from '../middleware/requireOrgOwner';
import type { Storage } from '../services/storage/Storage';
import { validateLogoUpload } from '../services/storage/uploadValidation';
import { validateBusinessName } from '../repos/businessName';

const LOGO_SIGNED_URL_TTL_SEC = 10 * 60;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

export interface OrgsRouterDeps {
  /** S3-compatible storage; required for logo upload/download. When unset, logo routes return 503. */
  storage?: Storage | null;
}

export function orgsRouter({ storage = null }: OrgsRouterDeps = {}): Router {
  const router = Router();

  // ── Orgs ────────────────────────────────────────────────────────────────────

  /** List orgs the current user belongs to. */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgs = await req.ctx!.repos.org.listForUser();
      res.json(orgs);
    } catch (err) { next(err); }
  });

  /** Create a new org (user becomes owner). */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body as { name: string };
      if (!name?.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const org = await req.ctx!.repos.org.create(name.trim());
      res.status(201).json(org);
    } catch (err) { next(err); }
  });

  // ── Members ─────────────────────────────────────────────────────────────────

  /** List members of an org (must be a member to view). */
  router.get('/:orgId/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await req.ctx!.repos.org.listMembers(req.params.orgId);
      res.json(members);
    } catch (err) { next(err); }
  });

  /** Remove a member from the org (owner only). */
  router.delete('/:orgId/members/:userId', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await req.ctx!.repos.org.removeMember(req.params.orgId, req.params.userId);
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ── Businesses ──────────────────────────────────────────────────────────────

  /** List businesses in the active org. */
  router.get('/:orgId/businesses', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await req.ctx!.repos.businesses.findAll();
      res.json(businesses);
    } catch (err) { next(err); }
  });

  /** Create a business in the active org (owner only). */
  router.post('/:orgId/businesses', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body as { name?: string };
      const check = validateBusinessName(name);
      if (!check.ok) {
        res.status(400).json({ error: check.error });
        return;
      }
      const business = await req.ctx!.repos.businesses.create(check.name);
      res.status(201).json(business);
    } catch (err) { next(err); }
  });

  /** Rename a business (owner only). */
  router.patch('/:orgId/businesses/:businessId', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body as { name?: string };
      const check = validateBusinessName(name);
      if (!check.ok) {
        res.status(400).json({ error: check.error });
        return;
      }
      const business = await req.ctx!.repos.businesses.rename(Number(req.params.businessId), check.name);
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      res.json(business);
    } catch (err) { next(err); }
  });

  /** Delete a business (owner only). */
  router.delete('/:orgId/businesses/:businessId', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await req.ctx!.repos.businesses.delete(Number(req.params.businessId));
      if (!deleted) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ── Business logo ───────────────────────────────────────────────────────────

  /**
   * Upload (replaces existing). Owner only.
   * multipart: file (required). Accepts PNG / JPEG / WebP, max 1 MB.
   * Returns the updated Business row.
   */
  router.post(
    '/:orgId/businesses/:businessId/logo',
    requireOrgOwner(),
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!storage) return res.status(503).json({ error: 'Object storage is not configured on this server' });
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const businessId = Number(req.params.businessId);
        const business = await req.ctx!.repos.businesses.findById(businessId);
        if (!business) return res.status(404).json({ error: 'Business not found' });

        const info = validateLogoUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
        const key = `logos/${businessId}/${randomUUID()}.${info.ext}`;
        await storage.put(key, req.file.buffer, info.contentType);

        const previousKey = await req.ctx!.repos.businesses.setLogo(businessId, key, info.contentType);
        if (previousKey) {
          // Best-effort: don't fail the upload if the old object is already gone.
          storage.delete(previousKey).catch(() => undefined);
        }

        const updated = await req.ctx!.repos.businesses.findById(businessId);
        res.status(201).json(updated);
      } catch (err) {
        if (err instanceof Error && /File (too large|is empty)|Unsupported file type|does not match detected/i.test(err.message)) {
          res.status(422).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  /** GET /api/orgs/:orgId/businesses/:businessId/logo → 302 to a short-lived signed URL. */
  router.get('/:orgId/businesses/:businessId/logo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businessId = Number(req.params.businessId);
      const business = await req.ctx!.repos.businesses.findById(businessId);
      if (!business) return res.status(404).json({ error: 'Business not found' });
      if (!business.logoStorageKey) return res.status(404).json({ error: 'No logo set' });
      if (!storage) return res.status(503).json({ error: 'Object storage is not configured on this server' });
      const url = await storage.getSignedUrl(business.logoStorageKey, LOGO_SIGNED_URL_TTL_SEC);
      res.redirect(url);
    } catch (err) { next(err); }
  });

  /** DELETE /api/orgs/:orgId/businesses/:businessId/logo. Owner only. */
  router.delete(
    '/:orgId/businesses/:businessId/logo',
    requireOrgOwner(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const businessId = Number(req.params.businessId);
        const previousKey = await req.ctx!.repos.businesses.clearLogo(businessId);
        if (previousKey === null) {
          // Either the business doesn't exist or it had no logo. Either way, no-op response.
          return res.status(204).send();
        }
        if (storage && previousKey) {
          storage.delete(previousKey).catch(() => undefined);
        }
        res.status(204).send();
      } catch (err) { next(err); }
    },
  );

  return router;
}

export default orgsRouter;
