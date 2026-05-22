import { Account, StartupCheckResult } from '@keepmyledger/shared';
import { AccountRepo } from '../repos/AccountRepo';

export class StatementTrackingService {
  constructor(private accountRepo: AccountRepo) {}

  /**
   * Returns accounts that are missing a statement for the previous calendar month.
   * "Previous month" is relative to today.
   */
  async getMissingPriorMonth(): Promise<StartupCheckResult> {
    const today = new Date();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevPeriod = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

    const accounts = await this.accountRepo.findAll();
    const missing: StartupCheckResult['missingStatements'] = [];

    for (const account of accounts) {
      if (!account.lastStatementPeriod || account.lastStatementPeriod < prevPeriod) {
        missing.push({ account, missingPeriod: prevPeriod });
      }
    }

    return { missingStatements: missing };
  }
}
