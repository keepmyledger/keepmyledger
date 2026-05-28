import { AiUsageRepo, todayUtc } from '../AiUsageRepo';
import { DbAdapter } from '../../db/adapter';

export class AiUsageRepoImpl implements AiUsageRepo {
  constructor(private db: DbAdapter, private userId: string) {}

  async getTodayCount(): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      'SELECT count FROM ai_usage WHERE user_id = ? AND day = ?',
      [this.userId, todayUtc()],
    );
    return row ? Number(row.count) : 0;
  }

  async getLifetimeCount(): Promise<number> {
    const row = await this.db.get<{ total: number }>(
      'SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE user_id = ?',
      [this.userId],
    );
    return row ? Number(row.total) : 0;
  }

  async incrementToday(): Promise<number> {
    // Atomic upsert + RETURNING works identically on sqlite and postgres.
    const row = await this.db.get<{ count: number }>(
      `INSERT INTO ai_usage(user_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET count = ai_usage.count + 1
       RETURNING count`,
      [this.userId, todayUtc()],
    );
    return Number(row!.count);
  }
}
