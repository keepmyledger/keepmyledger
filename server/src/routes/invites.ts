import { Router, Request, Response, NextFunction } from 'express';
import { requireOrgOwner } from '../middleware/requireOrgOwner';
import { DbAdapter } from '../db/adapter';
import { InviteRepoImpl } from '../repos/impl/InviteRepoImpl';
import { OrgRepoImpl } from '../repos/impl/OrgRepoImpl';

const router = Router({ mergeParams: true });

/**
 * Invite routes. Mounted at /api/orgs/:orgId/invites (for org-scoped ops)
 * and /api/invites (for public token-based ops — no requireUser needed there).
 */

// ── Org-scoped invite management (requires org membership) ───────────────────

/** List pending invites for the active org (owner only). */
router.get('/', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invites = await req.ctx!.repos.invites.listByOrg();
    res.json(invites);
  } catch (err) { next(err); }
});

/** Create an invite (owner only). */
router.post('/', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body as { email: string };
    if (!email?.trim()) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    const invite = await req.ctx!.repos.invites.create({ email: email.trim() });
    res.status(201).json(invite);
  } catch (err) { next(err); }
});

/** Expire/delete an invite (owner only). */
router.delete('/:inviteId', requireOrgOwner(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await req.ctx!.repos.invites.expire(req.params.inviteId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── Public token-based operations ─────────────────────────────────────────────

/**
 * Build a router for public invite endpoints. Requires `requireUser` auth
 * (to know who is accepting) but does NOT require org membership — it is
 * used to join an org via a link.
 *
 * Mounted at /api/invites in index.ts.
 */
export function publicInvitesRouter(db: DbAdapter): Router {
  const pub = Router();

  /** Accept an invite token. Adds the current user to the org and marks the invite accepted. */
  pub.post('/:token/accept', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.ctx?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const token = req.params.token;
      // findByToken has no org-id filter in the SQL
      const inviteRepo = new InviteRepoImpl(db, '', userId);
      const invite = await inviteRepo.findByToken(token);

      if (!invite) {
        res.status(404).json({ error: 'Invite not found' });
        return;
      }
      if (invite.status !== 'pending') {
        res.status(400).json({ error: `Invite is already ${invite.status}` });
        return;
      }
      if (new Date(invite.expiresAt) < new Date()) {
        // Auto-expire it and reject
        const scoped = new InviteRepoImpl(db, invite.orgId, userId);
        await scoped.expire(token);
        res.status(400).json({ error: 'Invite has expired' });
        return;
      }

      // Add user to org (idempotent)
      const orgRepo = new OrgRepoImpl(db, userId);
      await orgRepo.addMember(invite.orgId, userId, invite.role);

      // Mark invite accepted
      const scoped = new InviteRepoImpl(db, invite.orgId, userId);
      await scoped.accept(token);

      res.json({ ok: true, orgId: invite.orgId });
    } catch (err) { next(err); }
  });

  return pub;
}

export default router;
