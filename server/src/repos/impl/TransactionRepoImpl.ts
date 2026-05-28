import { Transaction, TransactionSplit, UpdateTransactionPayload, CategoryKind } from '@keepmyledger/shared';
import {
  TransactionRepo,
  TransactionFilter,
  ReportByCategoryRow,
  CashflowRow,
} from '../TransactionRepo';
import { DbAdapter } from '../../db/adapter';
import { hashTransaction } from '../../parsers/utils';

function toTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    statementId: row.statement_id as number,
    date: row.date as string,
    description: row.description as string,
    amount: Number(row.amount),
    categoryId: row.category_id as number | null,
    categorySource: row.category_source as Transaction['categorySource'],
    suggestedCategoryId: row.suggested_category_id as number | null,
    ruleId: row.rule_id as number | null,
    notes: row.notes as string | null,
    taxDescription: row.tax_description as string | null,
  };
}

export class TransactionRepoImpl implements TransactionRepo {
  constructor(private db: DbAdapter, private businessId: number) {}

  async findAll(filter?: TransactionFilter): Promise<Transaction[]> {
    const conditions: string[] = ['t.business_id = ?'];
    const values: unknown[] = [this.businessId];

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
    const rows = await this.db.all(`SELECT t.* FROM transactions t ${where} ORDER BY t.date DESC`, values);
    return rows.map(toTransaction);
  }

  async findById(id: number): Promise<Transaction | undefined> {
    const row = await this.db.get('SELECT * FROM transactions WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return row ? toTransaction(row) : undefined;
  }

  async findByHash(hash: string): Promise<Transaction | undefined> {
    const row = await this.db.get('SELECT * FROM transactions WHERE external_hash = ? AND business_id = ?', [hash, this.businessId]);
    return row ? toTransaction(row) : undefined;
  }

  async findExistingHashes(accountId: number, hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const placeholders = hashes.map(() => '?').join(', ');
    const rows = await this.db.all<{ external_hash: string }>(
      `SELECT external_hash FROM transactions
       WHERE business_id = ? AND account_id = ? AND external_hash IN (${placeholders})`,
      [this.businessId, accountId, ...hashes],
    );
    return new Set(rows.map((r) => r.external_hash));
  }

  async bulkCreate(transactions: Omit<Transaction, 'id'>[]): Promise<{ inserted: number }> {
    if (transactions.length === 0) return { inserted: 0 };
    let inserted = 0;
    await this.db.transaction(async (tx) => {
      for (const t of transactions) {
        const result = await tx.run(
          `INSERT INTO transactions
            (business_id, account_id, statement_id, date, description, amount, category_id, category_source,
             suggested_category_id, rule_id, notes, tax_description, external_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.businessId,
            t.accountId, t.statementId, t.date, t.description, t.amount,
            t.categoryId ?? null, t.categorySource ?? null,
            t.suggestedCategoryId ?? null, t.ruleId ?? null,
            t.notes ?? null,
            t.taxDescription ?? null,
            (t as unknown as Record<string, unknown>)['externalHash'] as string,
          ],
        );
        if (result.changes > 0) inserted++;
      }
    });
    return { inserted };
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

    // If any field that participates in the dedup hash changed, recompute it.
    if (
      payload.date !== undefined ||
      payload.description !== undefined ||
      payload.amount !== undefined
    ) {
      const accountIdRow = await this.db.get<{ account_id: number }>(
        'SELECT account_id FROM transactions WHERE id = ? AND business_id = ?',
        [id, this.businessId],
      );
      if (accountIdRow) {
        map['external_hash'] = hashTransaction(
          accountIdRow.account_id,
          (payload.date ?? existing.date) as string,
          (payload.description ?? existing.description) as string,
          (payload.amount ?? existing.amount) as number,
        );
      }
    }

    const entries = Object.entries(map);
    if (entries.length === 0) return existing;
    const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
    await this.db.run(
      `UPDATE transactions SET ${setClause} WHERE id = ? AND business_id = ?`,
      [...entries.map(([, v]) => v), id, this.businessId],
    );
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM transactions WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return result.changes > 0;
  }

  async bulkDelete(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.db.run(
      `DELETE FROM transactions WHERE id IN (${placeholders}) AND business_id = ?`,
      [...ids, this.businessId],
    );
    return result.changes;
  }

  async setRuleId(id: number, ruleId: number | null): Promise<void> {
    await this.db.run('UPDATE transactions SET rule_id = ? WHERE id = ? AND business_id = ?', [ruleId, id, this.businessId]);
  }

  async setSuggestedCategoryId(id: number, categoryId: number | null): Promise<void> {
    await this.db.run(
      'UPDATE transactions SET suggested_category_id = ? WHERE id = ? AND business_id = ?',
      [categoryId, id, this.businessId],
    );
  }

  async reportByCategory(year?: number): Promise<ReportByCategoryRow[]> {
    // Use substr() on YYYY-MM-DD text dates: works in both sqlite and pg.
    const yearClause = year ? "AND substr(t.date, 1, 4) = ?" : '';
    // Build params: first half goes to the non-split branch, second to the split branch.
    const half1: unknown[] = [this.businessId];
    if (year) half1.push(String(year));
    const half2: unknown[] = [this.businessId];
    if (year) half2.push(String(year));

    const rows = await this.db.all(`
      SELECT "categoryId", "categoryName", kind, SUM(total) AS total
      FROM (
        -- Non-split transactions: use parent category/amount
        SELECT
          t.category_id     AS "categoryId",
          c.name            AS "categoryName",
          c.kind            AS kind,
          SUM(t.amount)     AS total
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.business_id = ?
          AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)
          AND (c.kind IS NULL OR c.kind != 'transfer') ${yearClause}
        GROUP BY t.category_id, c.name, c.kind

        UNION ALL

        -- Split transactions: each split line contributes to its own category
        SELECT
          ts.category_id    AS "categoryId",
          c.name            AS "categoryName",
          c.kind            AS kind,
          SUM(ts.amount)    AS total
        FROM transaction_splits ts
        JOIN transactions t ON t.id = ts.transaction_id
        JOIN categories c ON c.id = ts.category_id
        WHERE t.business_id = ?
          AND c.kind != 'transfer' ${yearClause}
        GROUP BY ts.category_id, c.name, c.kind
      ) combined
      GROUP BY "categoryId", "categoryName", kind
      ORDER BY total ASC
    `, [...half1, ...half2]);
    return rows.map((r) => ({
      categoryId: r.categoryId as number | null,
      categoryName: r.categoryName as string | null,
      kind: r.kind as CategoryKind | null,
      total: Number(r.total),
    }));
  }

  async reportCashflow(year?: number): Promise<CashflowRow[]> {
    const yearClause = year ? "AND substr(t.date, 1, 4) = ?" : '';
    const params: unknown[] = [this.businessId];
    if (year) params.push(String(year));
    const rows = await this.db.all(`
      SELECT
        substr(t.date, 1, 7) AS period,
        SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
        SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) AS expenses,
        SUM(t.amount) AS net
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.business_id = ? AND (c.kind IS NULL OR c.kind != 'transfer') ${yearClause}
      GROUP BY period
      ORDER BY period ASC
    `, params);
    return rows.map((r) => ({
      period: r.period as string,
      income: Number(r.income),
      expenses: Number(r.expenses),
      net: Number(r.net),
    }));
  }

  async getSplits(transactionId: number): Promise<TransactionSplit[]> {
    const rows = await this.db.all(
      `SELECT ts.* FROM transaction_splits ts
       JOIN transactions t ON t.id = ts.transaction_id
       WHERE ts.transaction_id = ? AND t.business_id = ?
       ORDER BY ts.id ASC`,
      [transactionId, this.businessId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      transactionId: r.transaction_id as number,
      categoryId: r.category_id as number,
      amount: Number(r.amount),
      note: r.note as string | null,
    }));
  }

  async replaceSplits(
    transactionId: number,
    splits: Array<{ categoryId: number; amount: number; note?: string | null }>,
  ): Promise<TransactionSplit[]> {
    // Verify the transaction belongs to this user before touching splits.
    const tx = await this.findById(transactionId);
    if (!tx) throw new Error('Transaction not found');

    await this.db.transaction(async (trx) => {
      await trx.run('DELETE FROM transaction_splits WHERE transaction_id = ?', [transactionId]);
      const now = new Date().toISOString();
      for (const s of splits) {
        await trx.run(
          `INSERT INTO transaction_splits (transaction_id, category_id, amount, note, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [transactionId, s.categoryId, s.amount, s.note ?? null, now],
        );
      }
    });

    return this.getSplits(transactionId);
  }
}
