import { Account, CreateAccountPayload, UpdateAccountPayload } from '@keepmyledger/shared';

export interface AccountRepo {
  findAll(): Promise<Account[]>;
  findById(id: number): Promise<Account | undefined>;
  create(payload: CreateAccountPayload): Promise<Account>;
  update(id: number, payload: UpdateAccountPayload): Promise<Account | undefined>;
  delete(id: number): Promise<boolean>;
  updateLastStatementPeriod(id: number, period: string): Promise<void>;
}
