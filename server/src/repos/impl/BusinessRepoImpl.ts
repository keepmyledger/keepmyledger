import { Business, BusinessRepo, BusinessDeleteSummary, BusinessSummary } from '../BusinessRepo';
import { DbAdapter } from '../../db/adapter';
import { seedBusinessDefaults } from './seedBusiness';

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
  constructor(private db: DbAdapter, private orgId: string, private userId: string) {}

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
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{ id: number }>(
        'INSERT INTO businesses(org_id, name) VALUES (?, ?) RETURNING id',
        [this.orgId, name],
      );
      const id = Number(row!.id);
      await seedBusinessDefaults(tx, id, this.userId);
      const created = await tx.get(
        'SELECT * FROM businesses WHERE id = ? AND org_id = ?',
        [id, this.orgId],
      );
      return toBusiness(created!);
    });
  }

  async rename(id: number, name: string): Promise<Business | undefined> {
    await this.db.run(
      'UPDATE businesses SET name = ? WHERE id = ? AND org_id = ?',
      [name, id, this.orgId],
    );
    return this.findById(id);
  }

  async summarize(id: number): Promise<BusinessSummary | undefined> {
    const business = await this.findById(id);
    if (!business) return undefined;
    const counts = {
      accounts:     await this.countByBusiness('accounts', id),
      transactions: await this.countByBusiness('transactions', id),
      receipts:     await this.countByBusiness('receipts', id),
      statements:   await this.countByBusiness('statements', id),
      categories:   await this.countByBusiness('categories', id),
      rules:        await this.countByBusiness('rules', id),
    };
    return { business, counts };
  }

  async delete(id: number): Promise<BusinessDeleteSummary | null> {
    return this.db.transaction(async (tx) => {
      // Re-verify membership inside the transaction so callers don't have to
      // hold a row lock between findById and delete.
      const business = await tx.get(
        'SELECT * FROM businesses WHERE id = ? AND org_id = ?',
        [id, this.orgId],
      );
      if (!business) return null;

      // Collect S3 keys to clean up after commit. PG and SQLite both store the
      // key in receipts.storage_key when storage_backend = 's3'; drive receipts
      // are owned by the user's Google Drive and stay there.
      const receiptRows = await tx.all<{ storage_key: string | null }>(
        `SELECT storage_key FROM receipts
          WHERE business_id = ? AND storage_backend = 's3' AND storage_key IS NOT NULL`,
        [id],
      );
      const receiptStorageKeys = receiptRows
        .map((r) => r.storage_key)
        .filter((k): k is string => !!k);

      // Order matters: rules → statements → receipts → transactions → accounts → categories.
      // rules and categories have a FK between them on PG (rules.category_id REFERENCES categories),
      // so rules must go first. statements/receipts/transactions all reference accounts.
      await tx.run('DELETE FROM rules        WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM statements   WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM receipts     WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM transactions WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM accounts     WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM categories   WHERE business_id = ?', [id]);
      await tx.run('DELETE FROM businesses   WHERE id = ? AND org_id = ?', [id, this.orgId]);

      return {
        logoStorageKey: (business.logo_storage_key as string | null) ?? null,
        receiptStorageKeys,
      };
    });
  }

  private async countByBusiness(table: string, businessId: number): Promise<number> {
    // `table` is an internal allow-list of identifiers, never user-supplied.
    const row = await this.db.get<{ c: number | string }>(
      `SELECT COUNT(*) AS c FROM ${table} WHERE business_id = ?`,
      [businessId],
    );
    return Number(row?.c ?? 0);
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
