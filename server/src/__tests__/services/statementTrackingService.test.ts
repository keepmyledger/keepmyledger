import { StatementTrackingService } from '../../services/statementTrackingService';
import { makeTestDb, TestDb } from '../helpers/db';

function prevMonthPeriod(): string {
  const t = new Date();
  const p = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
}

describe('StatementTrackingService', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('flags accounts with no statement yet', async () => {
    const a = await h.owner.accounts.create({ name: 'A', bankType: 'mt', accountKind: 'checking' });
    const svc = new StatementTrackingService(h.owner.accounts);
    const res = await svc.getMissingPriorMonth();
    expect(res.missingStatements.map((m) => m.account.id)).toContain(a.id);
    expect(res.missingStatements[0].missingPeriod).toBe(prevMonthPeriod());
  });

  it('flags accounts whose last statement is older than previous month', async () => {
    const a = await h.owner.accounts.create({ name: 'A', bankType: 'mt', accountKind: 'checking' });
    await h.owner.accounts.updateLastStatementPeriod(a.id, '2020-01');
    const svc = new StatementTrackingService(h.owner.accounts);
    const res = await svc.getMissingPriorMonth();
    expect(res.missingStatements.find((m) => m.account.id === a.id)).toBeDefined();
  });

  it('does not flag accounts whose last statement is the previous month or newer', async () => {
    const a = await h.owner.accounts.create({ name: 'A', bankType: 'mt', accountKind: 'checking' });
    await h.owner.accounts.updateLastStatementPeriod(a.id, prevMonthPeriod());
    const svc = new StatementTrackingService(h.owner.accounts);
    const res = await svc.getMissingPriorMonth();
    expect(res.missingStatements.find((m) => m.account.id === a.id)).toBeUndefined();
  });
});
