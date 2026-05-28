import { Business, BusinessRepo } from '../BusinessRepo';
import { DbAdapter } from '../../db/adapter';

function toBusiness(row: Record<string, unknown>): Business {
  return {
    id: row.id as number,
    orgId: row.org_id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    logoStorageKey: (row.logo_storage_key ?? null) as string | null,
    logoContentType: (row.logo_content_type ?? null) as string | null,
  };
}

export class BusinessRepoImpl implements BusinessRepo {
  constructor(private db: DbAdapter, private orgId: string) {}

  async findAll(): Promise<Business[]> {
    const rows = await this.db.all(
      'SELECT * FROM businesses WHERE org_id = ? ORDER BY created_at',
      [this.orgId],
    );
    return rows.map(toBusiness);
  }

  async findById(id: number): Promise<Business | undefined> {
    const row = await this.db.get(
      'SELECT * FROM businesses WHERE id = ? AND org_id = ?',
      [id, this.orgId],
    );
    return row ? toBusiness(row) : undefined;
  }

  async create(name: string): Promise<Business> {
    const row = await this.db.get<{ id: number }>(
      'INSERT INTO businesses(org_id, name) VALUES (?, ?) RETURNING id',
      [this.orgId, name],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async rename(id: number, name: string): Promise<Business | undefined> {
    await this.db.run(
      'UPDATE businesses SET name = ? WHERE id = ? AND org_id = ?',
      [name, id, this.orgId],
    );
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM businesses WHERE id = ? AND org_id = ?',
      [id, this.orgId],
    );
    return result.changes > 0;
  }

  async setLogo(id: number, storageKey: string, contentType: string): Promise<string | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    await this.db.run(
      'UPDATE businesses SET logo_storage_key = ?, logo_content_type = ? WHERE id = ? AND org_id = ?',
      [storageKey, contentType, id, this.orgId],
    );
    return existing.logoStorageKey;
  }

  async clearLogo(id: number): Promise<string | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    await this.db.run(
      'UPDATE businesses SET logo_storage_key = NULL, logo_content_type = NULL WHERE id = ? AND org_id = ?',
      [id, this.orgId],
    );
    return existing.logoStorageKey;
  }
}
