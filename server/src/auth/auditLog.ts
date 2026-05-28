/**
 * auditLog.ts — Security audit log helper
 * ----------------------------------------
 * Lightweight wrapper for writing to security_audit_log. All writes are
 * fire-and-forget from the route layer (errors are logged but not surfaced to
 * callers so a logging failure never breaks user-facing operations).
 *
 * Action strings use snake_case. Canonical values:
 *   login_success, login_failure, login_mfa_success, login_mfa_failure,
 *   login_oauth_success,
 *   password_changed, password_reset_requested, password_reset_completed,
 *   email_changed,
 *   mfa_enabled, mfa_disabled,
 *   account_deleted,
 *   drive_connected, drive_disconnected,
 *   totp_setup_started
 */

import type { Request } from 'express';
import type { DbAdapter } from '../db/adapter';

export type SecurityAction =
  | 'login_success'
  | 'login_failure'
  | 'login_mfa_success'
  | 'login_mfa_failure'
  | 'login_oauth_success'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'email_changed'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'account_deleted'
  | 'drive_connected'
  | 'drive_disconnected'
  | 'totp_setup_started'
  | 'admin_grant_tier'
  | 'admin_revoke_grant';

interface AuditContext {
  userId?: string | null;
  action: SecurityAction;
  payload?: Record<string, unknown>;
  req?: Request;
}

/**
 * Write a security audit event. Non-throwing: errors are caught and logged
 * to stderr so a DB hiccup never propagates to callers.
 */
export function logSecurityEvent(db: DbAdapter, ctx: AuditContext): void {
  const ip    = ctx.req ? (ctx.req.ip ?? null) : null;
  const ua    = ctx.req ? (ctx.req.headers['user-agent'] ?? null) : null;
  const payload = ctx.payload ? JSON.stringify(ctx.payload) : null;

  db.run(
    `INSERT INTO security_audit_log(user_id, action, ip_address, user_agent, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [ctx.userId ?? null, ctx.action, ip, ua, payload],
  ).catch((err: unknown) => {
    console.error('[auditLog] failed to write security event:', err);
  });
}
