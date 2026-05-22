import { Category, CreateCategoryPayload, UpdateCategoryPayload } from '@keepmyledger/shared';
import { CategoryRepo } from '../CategoryRepo';
import { DbAdapter } from '../../db/adapter';

function toCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as number,
    name: row.name as string,
    kind: row.kind as Category['kind'],
    taxExportCode: row.tax_export_code as string | null,
  };
}

export class CategoryRepoImpl implements CategoryRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async findAll(): Promise<Category[]> {
    const rows = await this.db.all('SELECT * FROM categories WHERE user_id = ? ORDER BY kind, name', [this.userId]);
    return rows.map(toCategory);
  }

  async findById(id: number): Promise<Category | undefined> {
    const row = await this.db.get('SELECT * FROM categories WHERE id = ? AND user_id = ?', [id, this.userId]);
    return row ? toCategory(row) : undefined;
  }

  async findByName(name: string): Promise<Category | undefined> {
    const row = await this.db.get('SELECT * FROM categories WHERE name = ? AND user_id = ?', [name, this.userId]);
    return row ? toCategory(row) : undefined;
  }

  async create(payload: CreateCategoryPayload): Promise<Category> {
    const row = await this.db.get<{ id: number }>(
      'INSERT INTO categories(user_id, name, kind, tax_export_code) VALUES (?, ?, ?, ?) RETURNING id',
      [this.userId, payload.name, payload.kind, payload.taxExportCode ?? null],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async update(id: number, payload: UpdateCategoryPayload): Promise<Category | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { fields.push('name = ?'); values.push(payload.name); }
    if (payload.kind !== undefined) { fields.push('kind = ?'); values.push(payload.kind); }
    if (payload.taxExportCode !== undefined) { fields.push('tax_export_code = ?'); values.push(payload.taxExportCode); }
    if (fields.length === 0) return this.findById(id);
    values.push(id, this.userId);
    await this.db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, this.userId]);
    return result.changes > 0;
  }
}
