import { DatabaseSync } from 'node:sqlite';
import { Transaction, UpdateTransactionPayload, CategoryKind } from '@keepmyledger/shared';
import {
  TransactionRepo,
  TransactionFilter,
  ReportByCategoryRow,
  CashflowRow,
} from '../TransactionRepo';
import { hashTransaction } from '../../parsers/utils';

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    statementId: row.statement_id as number,
    date: row.date as string,
    description: row.description as string,
    amount: row.amount as number,
    categoryId: row.category_id as number | null,
    categorySource: row.category_source as Transaction['categorySource'],
    suggestedCategoryId: row.suggested_category_id as number | null,
    ruleId: row.rule_id as number | null,
    notes: row.notes as string | null,
    taxDescription: row.tax_description as string | null,
  };
}

export class SqliteTransactionRepo implements TransactionRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(filter?: TransactionFilter): Promise<Transaction[]> {
    const conditions: string[] = ['t.user_id = ?'];
    const values: unknown[] = [this.userId];

    if (filter?.accountId !== undefined) { conditions.push('account_id = ?'); values.push(filter.accountId); }
    if (filter?.statementId !== undefined) { conditions.push('statement_id = ?'); values.push(filter.statementId); }
    if (filter?.categoryId !== undefined) {
      if (filter.categoryId === null) {
        conditions.push('category_id IS NULL');
      } else {
        conditions.push('category_id = ?');
        values.push(filter.categoryId);
      }
    }
    if (filter?.dateFrom !== undefined) { conditions.push('date >= ?'); values.push(filter.dateFrom); }
    if (filter?.dateTo !== undefined) { conditions.push('date <= ?'); values.push(filter.dateTo); }
    if (filter?.hasReceipts === true) { conditions.push('EXISTS (SELECT 1 FROM transaction_receipts tr WHERE tr.transaction_id = t.id)'); }
    if (filter?.hasReceipts === false) { conditions.push('NOT EXISTS (SELECT 1 FROM transaction_receipts tr WHERE tr.transaction_id = t.id)'); }
    if (filter?.categorySource !== undefined) { conditions.push('category_source = ?'); values.push(filter.categorySource); }
    if (filter?.uncategorized) { conditions.push('category_id IS NULL AND (category_source IS NULL OR category_source = ?)'); values.push('suggested'); }
    if (filter?.kind !== undefined) {
      conditions.push('EXISTS (SELECT 1 FROM categories c WHERE c.id = t.category_id AND c.kind = ?)');
      values.push(filter.kind);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return (this.db.prepare(`SELECT t.* FROM transactions t ${where} ORDER BY t.date DESC`).all(...(values as (string | number | null)[])) as Record<string, unknown>[]).map(toTransaction);
  }

  async findById(id: number): Promise<Transaction | undefined> {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toTransaction(row) : undefined;
  }

  async findByHash(hash: string): Promise<Transaction | undefined> {
    const row = this.db.prepare('SELECT * FROM transactions WHERE external_hash = ? AND user_id = ?').get(hash, this.userId) as Record<string, unknown> | undefined;
    return row ? toTransaction(row) : undefined;
  }

  async bulkCreate(transactions: Omit<Transaction, 'id'>[]): Promise<{ inserted: number; skipped: number }> {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO transactions
        (user_id, account_id, statement_id, date, description, amount, category_id, category_source,
         suggested_category_id, rule_id, notes, tax_description, external_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    let skipped = 0;

    this.db.exec('BEGIN');
    try {
      for (const tx of transactions) {
        const result = stmt.run(
          this.userId,
          tx.accountId, tx.statementId, tx.date, tx.description, tx.amount,
          tx.categoryId ?? null, tx.categorySource ?? null,
          tx.suggestedCategoryId ?? null, tx.ruleId ?? null,
          tx.notes ?? null,
          tx.taxDescription ?? null,
          (tx as unknown as Record<string, unknown>)['externalHash'] as string
        );
        if (result.changes > 0) inserted++; else skipped++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { inserted, skipped };
  }

  async update(id: number, payload: UpdateTransactionPayload): Promise<Transaction | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    const map: Record<string, unknown> = {};
    if (payload.date !== undefined) map['date'] = payload.date;
    if (payload.description !== undefined) map['description'] = payload.description;
    if (payload.amount !== undefined) map['amount'] = payload.amount;
    if (payload.categoryId !== undefined) map['category_id'] = payload.categoryId;
    if (payload.categorySource !== undefined) map['category_source'] = payload.categorySource;
    if (payload.notes !== undefined) map['notes'] = payload.notes;
    if (payload.taxDescription !== undefined) map['tax_description'] = payload.taxDescription;

    // If any field that participates in the dedup hash changed, recompute it
    // so future imports of the same statement still deduplicate correctly.
    if (
      payload.date !== undefined ||
      payload.description !== undefined ||
      payload.amount !== undefined
    ) {
      const accountIdRow = this.db
        .prepare('SELECT account_id FROM transactions WHERE id = ? AND user_id = ?')
        .get(id, this.userId) as { account_id: number } | undefined;
      if (accountIdRow) {
        map['external_hash'] = hashTransaction(
          accountIdRow.account_id,
          (payload.date ?? existing.date) as string,
          (payload.description ?? existing.description) as string,
          (payload.amount ?? existing.amount) as number
        );
      }
    }

    const entries = Object.entries(map);
    if (entries.length === 0) return existing;
    const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ? AND user_id = ?`).run(...([...entries.map(([, v]) => v), id, this.userId] as (string | number | null)[]));
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    return this.db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, this.userId).changes > 0;
  }

  async bulkDelete(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = this.db
      .prepare(`DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`)
      .run(...([...ids, this.userId] as (string | number)[]));
    return Number(result.changes);
  }

  async setRuleId(id: number, ruleId: number | null): Promise<void> {
    this.db.prepare('UPDATE transactions SET rule_id = ? WHERE id = ? AND user_id = ?').run(ruleId, id, this.userId);
  }

  async setSuggestedCategoryId(id: number, categoryId: number | null): Promise<void> {
    this.db.prepare('UPDATE transactions SET suggested_category_id = ? WHERE id = ? AND user_id = ?').run(categoryId, id, this.userId);
  }

  async reportByCategory(year?: number): Promise<ReportByCategoryRow[]> {
    const yearClause = year ? `AND strftime('%Y', t.date) = '${year}'` : '';
    return (this.db.prepare(`
      SELECT
        t.category_id     AS categoryId,
        c.name            AS categoryName,
        c.kind            AS kind,
        SUM(t.amount)     AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND (c.kind IS NULL OR c.kind != 'transfer') ${yearClause}
      GROUP BY t.category_id
      ORDER BY total ASC
    `).all(this.userId) as Record<string, unknown>[]).map((r) => ({
      categoryId: r.categoryId as number | null,
      categoryName: r.categoryName as string | null,
      kind: r.kind as CategoryKind | null,
      total: r.total as number,
    }));
  }

  async reportCashflow(year?: number): Promise<CashflowRow[]> {
    const yearClause = year ? `AND strftime('%Y', t.date) = '${year}'` : '';
    return (this.db.prepare(`
      SELECT
        strftime('%Y-%m', t.date) AS period,
        SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
        SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) AS expenses,
        SUM(t.amount) AS net
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND (c.kind IS NULL OR c.kind != 'transfer') ${yearClause}
      GROUP BY period
      ORDER BY period ASC
    `).all(this.userId) as Record<string, unknown>[]).map((r) => ({
      period: r.period as string,
      income: r.income as number,
      expenses: r.expenses as number,
      net: r.net as number,
    }));
  }
}
