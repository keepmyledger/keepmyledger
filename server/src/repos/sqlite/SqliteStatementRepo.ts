import { DatabaseSync } from 'node:sqlite';
import { Statement } from '@keepmyledger/shared';
import { StatementRepo } from '../StatementRepo';

function toStatement(row: Record<string, unknown>): Statement {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    period: row.period as string,
    sourcePdfPath: row.source_pdf_path as string,
    parserUsed: row.parser_used as Statement['parserUsed'],
    importedAt: row.imported_at as string,
  };
}

export class SqliteStatementRepo implements StatementRepo {
  constructor(private db: DatabaseSync, private userId: string) {}

  async findAll(): Promise<Statement[]> {
    return (this.db.prepare('SELECT * FROM statements WHERE user_id = ? ORDER BY period DESC').all(this.userId) as Record<string, unknown>[]).map(toStatement);
  }

  async findByAccount(accountId: number): Promise<Statement[]> {
    return (this.db.prepare('SELECT * FROM statements WHERE account_id = ? AND user_id = ? ORDER BY period DESC').all(accountId, this.userId) as Record<string, unknown>[]).map(toStatement);
  }

  async findById(id: number): Promise<Statement | undefined> {
    const row = this.db.prepare('SELECT * FROM statements WHERE id = ? AND user_id = ?').get(id, this.userId) as Record<string, unknown> | undefined;
    return row ? toStatement(row) : undefined;
  }

  async findByAccountAndPeriod(accountId: number, period: string): Promise<Statement | undefined> {
    const row = this.db.prepare('SELECT * FROM statements WHERE account_id = ? AND period = ? AND user_id = ?').get(accountId, period, this.userId) as Record<string, unknown> | undefined;
    return row ? toStatement(row) : undefined;
  }

  async create(data: Omit<Statement, 'id' | 'importedAt'>): Promise<Statement> {
    const result = this.db
      .prepare('INSERT INTO statements(user_id, account_id, period, source_pdf_path, parser_used) VALUES (?, ?, ?, ?, ?)')
      .run(this.userId, data.accountId, data.period, data.sourcePdfPath, data.parserUsed);
    return (await this.findById(Number(result.lastInsertRowid)))!;
  }

  async delete(id: number): Promise<boolean> {
    return this.db.prepare('DELETE FROM statements WHERE id = ? AND user_id = ?').run(id, this.userId).changes > 0;
  }
}
