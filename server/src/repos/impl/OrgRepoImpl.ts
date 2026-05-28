import crypto from 'node:crypto';
import { Org, OrgMember, OrgRepo } from '../OrgRepo';
import { DbAdapter } from '../../db/adapter';

function toOrg(row: Record<string, unknown>): Org {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  };
}

function toMember(row: Record<string, unknown>): OrgMember {
  return {
    userId: row.user_id as string,
    orgId: row.org_id as string,
    role: row.role as 'owner' | 'member',
    createdAt: row.created_at as string,
  };
}

export class OrgRepoImpl implements OrgRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async listForUser(): Promise<Org[]> {
    const rows = await this.db.all(
      `SELECT o.*
       FROM organizations o
       JOIN org_memberships m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at`,
      [this.userId],
    );
    return rows.map(toOrg);
  }

  async findById(orgId: string): Promise<Org | undefined> {
    const row = await this.db.get(
      `SELECT o.*
       FROM organizations o
       JOIN org_memberships m ON m.org_id = o.id
       WHERE o.id = ? AND m.user_id = ?`,
      [orgId, this.userId],
    );
    return row ? toOrg(row) : undefined;
  }

  async create(name: string): Promise<Org> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db.run(
      'INSERT INTO organizations(id, name, created_at) VALUES (?, ?, ?)',
      [id, name, now],
    );
    await this.db.run(
      `INSERT INTO org_memberships(org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      [id, this.userId, now],
    );
    return (await this.findById(id))!;
  }

  async getRole(orgId: string): Promise<'owner' | 'member' | undefined> {
    const row = await this.db.get(
      'SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ?',
      [orgId, this.userId],
    );
    return row ? (row.role as 'owner' | 'member') : undefined;
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const rows = await this.db.all(
      `SELECT m.*
       FROM org_memberships m
       WHERE m.org_id = ?
         AND EXISTS (
           SELECT 1 FROM org_memberships my WHERE my.org_id = ? AND my.user_id = ?
         )
       ORDER BY m.created_at`,
      [orgId, orgId, this.userId],
    );
    return rows.map(toMember);
  }

  async addMember(orgId: string, userId: string, role: 'owner' | 'member'): Promise<void> {
    await this.db.run(
      `INSERT INTO org_memberships(org_id, user_id, role)
       VALUES (?, ?, ?)
       ON CONFLICT(org_id, user_id) DO NOTHING`,
      [orgId, userId, role],
    );
  }

  async removeMember(orgId: string, userId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM org_memberships WHERE org_id = ? AND user_id = ?',
      [orgId, userId],
    );
    return result.changes > 0;
  }
}
