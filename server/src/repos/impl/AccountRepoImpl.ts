import { Account, CreateAccountPayload, UpdateAccountPayload, CsvColumnMapping } from '@keepmyledger/shared';
import { AccountRepo } from '../AccountRepo';
import { DbAdapter } from '../../db/adapter';

function parseCsvMapping(raw: unknown): CsvColumnMapping | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as CsvColumnMapping;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as CsvColumnMapping; } catch { return null; }
  }
  return null;
}

function toAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as number,
    name: row.name as string,
    bankType: row.bank_type as Account['bankType'],
    accountKind: row.account_kind as Account['accountKind'],
    lastStatementPeriod: row.last_statement_period as string | null,
    createdAt: row.created_at as string,
    csvMapping: parseCsvMapping(row.csv_mapping),
  };
}

export class AccountRepoImpl implements AccountRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async findAll(): Promise<Account[]> {
    const rows = await this.db.all('SELECT * FROM accounts WHERE user_id = ? ORDER BY name', [this.userId]);
    return rows.map(toAccount);
  }

  async findById(id: number): Promise<Account | undefined> {
    const row = await this.db.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [id, this.userId]);
    return row ? toAccount(row) : undefined;
  }

  async create(payload: CreateAccountPayload): Promise<Account> {
    const row = await this.db.get<{ id: number }>(
      'INSERT INTO accounts(user_id, name, bank_type, account_kind) VALUES (?, ?, ?, ?) RETURNING id',
      [this.userId, payload.name, payload.bankType, payload.accountKind],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async update(id: number, payload: UpdateAccountPayload): Promise<Account | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) { fields.push('name = ?'); values.push(payload.name); }
    if (payload.bankType !== undefined) { fields.push('bank_type = ?'); values.push(payload.bankType); }
    if (payload.accountKind !== undefined) { fields.push('account_kind = ?'); values.push(payload.accountKind); }
    if (payload.lastStatementPeriod !== undefined) { fields.push('last_statement_period = ?'); values.push(payload.lastStatementPeriod); }
    if (payload.csvMapping !== undefined) {
      fields.push('csv_mapping = ?');
      values.push(payload.csvMapping === null ? null : JSON.stringify(payload.csvMapping));
    }
    if (fields.length === 0) return this.findById(id);
    values.push(id, this.userId);
    await this.db.run(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM accounts WHERE id = ? AND user_id = ?', [id, this.userId]);
    return result.changes > 0;
  }

  async updateLastStatementPeriod(id: number, period: string): Promise<void> {
    await this.db.run('UPDATE accounts SET last_statement_period = ? WHERE id = ? AND user_id = ?', [period, id, this.userId]);
  }
}
