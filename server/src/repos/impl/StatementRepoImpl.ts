import { Statement } from '@keepmyledger/shared';
import { StatementRepo } from '../StatementRepo';
import { DbAdapter } from '../../db/adapter';

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

export class StatementRepoImpl implements StatementRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async findAll(): Promise<Statement[]> {
    const rows = await this.db.all('SELECT * FROM statements WHERE user_id = ? ORDER BY period DESC', [this.userId]);
    return rows.map(toStatement);
  }

  async findByAccount(accountId: number): Promise<Statement[]> {
    const rows = await this.db.all(
      'SELECT * FROM statements WHERE account_id = ? AND user_id = ? ORDER BY period DESC',
      [accountId, this.userId],
    );
    return rows.map(toStatement);
  }

  async findById(id: number): Promise<Statement | undefined> {
    const row = await this.db.get('SELECT * FROM statements WHERE id = ? AND user_id = ?', [id, this.userId]);
    return row ? toStatement(row) : undefined;
  }

  async findByAccountAndPeriod(accountId: number, period: string): Promise<Statement | undefined> {
    const row = await this.db.get(
      'SELECT * FROM statements WHERE account_id = ? AND period = ? AND user_id = ?',
      [accountId, period, this.userId],
    );
    return row ? toStatement(row) : undefined;
  }

  async create(data: Omit<Statement, 'id' | 'importedAt'>): Promise<Statement> {
    const row = await this.db.get<{ id: number }>(
      'INSERT INTO statements(user_id, account_id, period, source_pdf_path, parser_used) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [this.userId, data.accountId, data.period, data.sourcePdfPath, data.parserUsed],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM statements WHERE id = ? AND user_id = ?', [id, this.userId]);
    return result.changes > 0;
  }
}
