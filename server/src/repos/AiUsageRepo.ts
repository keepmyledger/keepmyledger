/**
 * Per-user, per-day counter for AI Assist requests. Backs the daily quota
 * enforced by the `/api/transactions/:id/ai-suggest` endpoint.
 *
 * The "day" key is a UTC YYYY-MM-DD string so counts reset at 00:00 UTC.
 */
export interface AiUsageRepo {
  /** Returns the current count for today (UTC), or 0 if no row yet. */
  getTodayCount(): Promise<number>;

  /**
   * Atomically increments today's counter (upserting a row if needed) and
   * returns the new count.
   */
  incrementToday(): Promise<number>;
}

/** UTC day key used as the `day` column value. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
