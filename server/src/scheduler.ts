/**
 * scheduler: lightweight background job runner.
 *
 * Currently owns one task: trial-ending email reminder.
 * Runs once at startup (after a short delay so the DB is warm), then every
 * hour. Does not crash the process on error; all exceptions are caught and
 * logged.
 *
 * Only runs in SaaS mode (APP_MODE=saas). Safe to call in self-host;
 * the short-circuit at the top of each task prevents unnecessary DB queries.
 */

import type { DbAdapter } from './db/adapter';
import { trialEndingEmail } from './services/emailService';
import { decryptNullable } from './auth/crypto';

const TRIAL_REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 30 * 1000; // 30 seconds after boot

interface TrialRow {
  user_id: string;
  trial_ends_at: string;
  email_enc: string | null;
  name_enc: string | null;
  username: string | null;
}

async function sendTrialEndingReminders(db: DbAdapter): Promise<void> {
  if (process.env.APP_MODE !== 'saas') return;

  const windowEnd = new Date(Date.now() + TRIAL_REMINDER_WINDOW_MS).toISOString();

  // subscriptions.org_id is the PK (post org-mode migration). For personal
  // orgs the convention is org_id = userId, so joining users by id matches.
  // email/name are encrypted at rest (PR #60); decrypt in JS below.
  const rows = await db.all<TrialRow>(`
    SELECT s.org_id AS user_id, s.trial_ends_at, u.email_enc, u.name_enc, u.username
    FROM subscriptions s
    INNER JOIN users u ON u.id = s.org_id
    WHERE s.status = 'trialing'
      AND s.trial_ends_at IS NOT NULL
      AND s.trial_ends_at <= ?
      AND s.trial_ending_email_sent_at IS NULL
      AND u.email_enc IS NOT NULL
  `, [windowEnd]);

  for (const row of rows) {
    try {
      const email = decryptNullable(row.email_enc);
      if (!email) continue;
      const name  = decryptNullable(row.name_enc);
      const daysLeft = Math.max(
        0,
        Math.ceil((new Date(row.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      );
      const displayName = name ?? row.username ?? 'there';
      trialEndingEmail(displayName, email, daysLeft);

      await db.run(
        `UPDATE subscriptions SET trial_ending_email_sent_at = ? WHERE org_id = ?`,
        [new Date().toISOString(), row.user_id],
      );
    } catch (err) {
      console.error('[scheduler] trial reminder failed for user', row.user_id, (err as Error).message);
    }
  }

  if (rows.length > 0) {
    console.log(`[scheduler] sent ${rows.length} trial-ending reminder(s)`);
  }
}

export function startScheduler(db: DbAdapter): void {
  async function tick() {
    try {
      await sendTrialEndingReminders(db);
    } catch (err) {
      console.error('[scheduler] tick error:', (err as Error).message);
    }
  }

  // Initial run after a short delay, then every hour.
  const initial = setTimeout(() => void tick(), INITIAL_DELAY_MS);
  const recurring = setInterval(() => void tick(), INTERVAL_MS);

  // Allow the process to exit cleanly even if these are still pending.
  initial.unref?.();
  recurring.unref?.();
}
