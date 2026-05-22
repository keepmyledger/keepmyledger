import { Statement } from '@keepmyledger/shared';

export interface StatementRepo {
  findAll(): Promise<Statement[]>;
  findByAccount(accountId: number): Promise<Statement[]>;
  findById(id: number): Promise<Statement | undefined>;
  findByAccountAndPeriod(accountId: number, period: string): Promise<Statement | undefined>;
  create(data: Omit<Statement, 'id' | 'importedAt'>): Promise<Statement>;
  delete(id: number): Promise<boolean>;
}
