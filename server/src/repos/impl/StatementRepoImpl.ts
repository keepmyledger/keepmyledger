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
  constructor(private db: DbAdapter, private businessId: number) {}

  async findAll(): Promise<Statement[]> {
    const rows = await this.db.all('SELECT * FROM statements WHERE business_id = ? ORDER BY period DESC', [this.businessId]);
    return rows.map(toStatement);
  }

  async findByAccount(accountId: number): Promise<Statement[]> {
    const rows = await this.db.all(
      'SELECT * FROM statements WHERE account_id = ? AND business_id = ? ORDER BY period DESC',
      [accountId, this.businessId],
    );
    return rows.map(toStatement);
  }

  async findById(id: number): Promise<Statement | undefined> {
    const row = await this.db.get('SELECT * FROM statements WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return row ? toStatement(row) : undefined;
  }

  async findByAccountAndPeriod(accountId: number, period: string): Promise<Statement | undefined> {
    const row = await this.db.get(
      'SELECT * FROM statements WHERE account_id = ? AND period = ? AND business_id = ?',
      [accountId, period, this.businessId],
    );
    return row ? toStatement(row) : undefined;
  }

  async create(data: Omit<Statement, 'id' | 'importedAt'>): Promise<Statement> {
    const row = await this.db.get<{ id: number }>(
      'INSERT INTO statements(business_id, account_id, period, source_pdf_path, parser_used) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [this.businessId, data.accountId, data.period, data.sourcePdfPath, data.parserUsed],
    );
    return (await this.findById(Number(row!.id)))!;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run('DELETE FROM statements WHERE id = ? AND business_id = ?', [id, this.businessId]);
    return result.changes > 0;
  }
}
