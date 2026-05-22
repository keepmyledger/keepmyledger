import { DatabaseSync } from 'node:sqlite';
import { Category, CreateCategoryPayload, UpdateCategoryPayload } from '@keepmyledger/shared';
import { CategoryRepo } from '../CategoryRepo';

function toCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as number,
    name: row.name as string,
    kind: row.kind as Category['kind'],
    taxExportCode: row.tax_export_code as string | null,
  };
}

export class SqliteCategoryRepo implements CategoryRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(): Promise<Category[]> {
    return (this.db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY kind, name').all(this.userId) as Record<string, unknown>[]).map(toCategory);
  }

  async findById(id: number): Promise<Category | undefined> {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toCategory(row) : undefined;
  }

  async findByName(name: string): Promise<Category | undefined> {
    const row = this.db.prepare('SELECT * FROM categories WHERE name = ? AND user_id = ?').get(name, this.userId) as Record<string, unknown> | undefined;
    return row ? toCategory(row) : undefined;
  }

  async create(payload: CreateCategoryPayload): Promise<Category> {
    const result = this.db
      .prepare('INSERT INTO categories(user_id, name, kind, tax_export_code) VALUES (?, ?, ?, ?)')
      .run(this.userId, payload.name, payload.kind, payload.taxExportCode ?? null);
    return (await this.findById(Number(result.lastInsertRowid)))!;
  }

  async update(id: number, payload: UpdateCategoryPayload): Promise<Category | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { fields.push('name = ?'); values.push(payload.name); }
    if (payload.kind !== undefined) { fields.push('kind = ?'); values.push(payload.kind); }
    if (payload.taxExportCode !== undefined) { fields.push('tax_export_code = ?'); values.push(payload.taxExportCode); }
    if (fields.length === 0) return this.findById(id);
    values.push(id, this.userId);
    this.db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...(values as (string | number | null)[]));
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, this.userId);
    return result.changes > 0;
  }
}
