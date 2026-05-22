import { DatabaseSync } from 'node:sqlite';
import { Account, CreateAccountPayload, UpdateAccountPayload } from '@keepmyledger/shared';
import { AccountRepo } from '../AccountRepo';

function toAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as number,
    name: row.name as string,
    bankType: row.bank_type as Account['bankType'],
    accountKind: row.account_kind as Account['accountKind'],
    lastStatementPeriod: row.last_statement_period as string | null,
    createdAt: row.created_at as string,
  };
}

export class SqliteAccountRepo implements AccountRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(): Promise<Account[]> {
    return (this.db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY name').all(this.userId) as Record<string, unknown>[]).map(toAccount);
  }

  async findById(id: number): Promise<Account | undefined> {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toAccount(row) : undefined;
  }

  async create(payload: CreateAccountPayload): Promise<Account> {
    const result = this.db
      .prepare('INSERT INTO accounts(user_id, name, bank_type, account_kind) VALUES (?, ?, ?, ?)')
      .run(this.userId, payload.name, payload.bankType, payload.accountKind);
    return (await this.findById(Number(result.lastInsertRowid)))!;
  }

  async update(id: number, payload: UpdateAccountPayload): Promise<Account | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { fields.push('name = ?'); values.push(payload.name); }
    if (payload.bankType !== undefined) { fields.push('bank_type = ?'); values.push(payload.bankType); }
    if (payload.accountKind !== undefined) { fields.push('account_kind = ?'); values.push(payload.accountKind); }
    if (payload.lastStatementPeriod !== undefined) { fields.push('last_statement_period = ?'); values.push(payload.lastStatementPeriod); }
    if (fields.length === 0) return this.findById(id);
    values.push(id, this.userId);
    this.db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...(values as (string | number | null)[]));
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, this.userId);
    return result.changes > 0;
  }

  async updateLastStatementPeriod(id: number, period: string): Promise<void> {
    this.db.prepare('UPDATE accounts SET last_statement_period = ? WHERE id = ? AND user_id = ?').run(period, id, this.userId);
  }
}
