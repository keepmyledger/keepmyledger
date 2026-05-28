import crypto from 'node:crypto';
import { OrgInvite, InviteRepo, InviteStatus } from '../InviteRepo';
import { DbAdapter } from '../../db/adapter';

const INVITE_TTL_DAYS = 7;

function toInvite(row: Record<string, unknown>): OrgInvite {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    invitedBy: row.invited_by as string,
    email: row.email as string,
    role: row.role as 'owner' | 'member',
    status: row.status as InviteStatus,
    expiresAt: row.expires_at as string,
    createdAt: row.created_at as string,
  };
}

export class InviteRepoImpl implements InviteRepo {
  constructor(
    private db: DbAdapter,
    private orgId: string,
    private invitedById: string,
  ) {}

  async findByToken(token: string): Promise<OrgInvite | undefined> {
    const row = await this.db.get(
      'SELECT * FROM org_invites WHERE id = ?',
      [token],
    );
    return row ? toInvite(row) : undefined;
  }

  async listByOrg(): Promise<OrgInvite[]> {
    const rows = await this.db.all(
      'SELECT * FROM org_invites WHERE org_id = ? ORDER BY created_at DESC',
      [this.orgId],
    );
    return rows.map(toInvite);
  }

  async create(data: Pick<OrgInvite, 'email'> & { role?: OrgInvite['role'] }): Promise<OrgInvite> {
    const id = crypto.randomUUID();
    const role = data.role ?? 'member';
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
    await this.db.run(
      `INSERT INTO org_invites(id, org_id, invited_by, email, role, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, this.orgId, this.invitedById, data.email, role, expiresAt],
    );
    return (await this.findByToken(id))!;
  }

  async accept(token: string): Promise<void> {
    await this.db.run(
      `UPDATE org_invites SET status = 'accepted' WHERE id = ? AND org_id = ?`,
      [token, this.orgId],
    );
  }

  async expire(token: string): Promise<void> {
    await this.db.run(
      `UPDATE org_invites SET status = 'expired' WHERE id = ? AND org_id = ?`,
      [token, this.orgId],
    );
  }

  async delete(token: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM org_invites WHERE id = ? AND org_id = ?',
      [token, this.orgId],
    );
    return result.changes > 0;
  }
}
