import { makeTestDb, TestDb } from '../helpers/db';
import { todayUtc } from '../../repos/AiUsageRepo';

describe('AiUsageRepo', () => {
  let h: TestDb;
  beforeEach(async () => { h = await makeTestDb(); });
  afterEach(() => h.close());

  it('getTodayCount returns 0 before any increment', async () => {
    expect(await h.owner.aiUsage.getTodayCount()).toBe(0);
  });

  it('incrementToday upserts and returns the running count', async () => {
    expect(await h.owner.aiUsage.incrementToday()).toBe(1);
    expect(await h.owner.aiUsage.incrementToday()).toBe(2);
    expect(await h.owner.aiUsage.incrementToday()).toBe(3);
    expect(await h.owner.aiUsage.getTodayCount()).toBe(3);
  });

  it('counts are isolated per user', async () => {
    await h.owner.aiUsage.incrementToday();
    await h.owner.aiUsage.incrementToday();
    await h.alt.aiUsage.incrementToday();

    expect(await h.owner.aiUsage.getTodayCount()).toBe(2);
    expect(await h.alt.aiUsage.getTodayCount()).toBe(1);
  });

  it('todayUtc returns YYYY-MM-DD in UTC', () => {
    const day = todayUtc(new Date('2026-05-21T23:30:00Z'));
    expect(day).toBe('2026-05-21');
    // Just before UTC midnight is still the same day, even in local PDT.
    expect(todayUtc(new Date('2026-05-22T00:00:00Z'))).toBe('2026-05-22');
  });
});
