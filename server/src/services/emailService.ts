/**
 * emailService: AWS SES v3 wrapper for transactional email.
 *
 * All calls are fire-and-forget safe; errors are logged but never surface to
 * the caller (so a failed email never breaks a signup flow).
 *
 * Required env vars (in SaaS mode):
 *   AWS_REGION:            e.g. "us-east-1"
 *   AWS_ACCESS_KEY_ID:    IAM key with ses:SendEmail on the verified identity
 *   AWS_SECRET_ACCESS_KEY
 *   SES_FROM_ADDRESS:     e.g. "KeepMyLedger <noreply@keepmyledger.com>"
 *   SES_CONFIGURATION_SET: (optional) SES config-set name for bounce tracking
 *   APP_URL:              e.g. "https://app.keepmyledger.com"
 *
 * When SES_FROM_ADDRESS is absent (local dev / self-host), emails are logged
 * to the console instead of sent.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { hashEmail } from '../auth/emailHash';

interface SendOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Lazily initialised so the module loads fine without AWS creds in dev/self-host.
let sesClient: SESv2Client | null = null;

// Optional DB adapter for suppression checks (bounce/complaint).
// Set once at startup via initEmailService().
let _db: import('../db/adapter').DbAdapter | null = null;

/** Call once after the DB is ready to enable suppression checks. */
export function initEmailService(db: import('../db/adapter').DbAdapter): void {
  _db = db;
}

function getClient(): SESv2Client {
  if (!sesClient) {
    sesClient = new SESv2Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  }
  return sesClient;
}

export async function sendEmail(opts: SendOptions): Promise<void> {
  const from = process.env.SES_FROM_ADDRESS;

  // Check suppression list before sending (bounce/complaint).
  if (_db) {
    try {
      const row = await _db.get<{ email_bounced_at: string | null; email_complained_at: string | null }>(
        `SELECT email_bounced_at, email_complained_at FROM users WHERE email_hash = ?`,
        [hashEmail(opts.to)],
      );
      if (row?.email_bounced_at || row?.email_complained_at) {
        console.warn('[email] suppressed send to', opts.to, '(bounce/complaint on record)');
        return;
      }
    } catch (err) {
      console.error('[email] suppression check failed:', (err as Error).message);
    }
  }

  if (!from) {
    // No SES config; log to console for local dev visibility.
    console.log(`[email:dev] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}\n`);
    return;
  }

  try {
    const cmd = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [opts.to] },
      Content: {
        Simple: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: opts.html, Charset: 'UTF-8' },
            Text: { Data: opts.text, Charset: 'UTF-8' },
          },
        },
      },
      ...(process.env.SES_CONFIGURATION_SET
        ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
        : {}),
    });
    await getClient().send(cmd);
  } catch (err) {
    // Never crash the caller; email delivery failure is non-fatal.
    console.error('[email] SES send failed:', (err as Error).message, '| to:', opts.to);
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const appUrl = () => process.env.APP_URL ?? 'https://app.keepmyledger.com';

function baseHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KeepMyLedger</title>
  <style>
    body { margin: 0; padding: 0; background: #F5F4EF; font-family: Georgia, serif; color: #2C3E35; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #FFFDF8; border-radius: 8px; overflow: hidden; border: 1px solid #D9D5C8; }
    .header { background: #2C6E49; padding: 24px 32px; }
    .header h1 { margin: 0; color: #FFFDF8; font-size: 22px; font-family: Georgia, serif; }
    .body { padding: 32px; }
    .body p { margin: 0 0 16px; line-height: 1.6; }
    .btn { display: inline-block; padding: 12px 24px; background: #2C6E49; color: #FFFDF8 !important; border-radius: 6px; text-decoration: none; font-weight: bold; font-family: Arial, sans-serif; font-size: 15px; margin: 8px 0 16px; }
    .footer { padding: 16px 32px; border-top: 1px solid #EAE8DF; color: #9E9B8E; font-size: 12px; font-family: Arial, sans-serif; }
    .footer a { color: #9E9B8E; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>KeepMyLedger</h1></div>
    <div class="body">${bodyContent}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Creek Ridge LLC &bull;
      <a href="${appUrl()}/privacy">Privacy Policy</a> &bull;
      <a href="${appUrl()}/terms">Terms of Service</a>
    </div>
  </div>
</body>
</html>`;
}

// ── Welcome email ─────────────────────────────────────────────────────────────

function formatIsoDate(iso: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [year, month, day] = iso.split('T')[0].split('-');
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}

export function welcomeEmail(displayName: string, recipientEmail: string, trialEndsAt?: string | null): void {
  const subject = 'Welcome to KeepMyLedger';
  const trialHtml = trialEndsAt
    ? `Your free trial is active through <strong>${formatIsoDate(trialEndsAt)}</strong>.`
    : 'Get started today.';
  const trialText = trialEndsAt
    ? `Your free trial is active through ${formatIsoDate(trialEndsAt)}.`
    : 'Get started today.';
  const html = baseHtml(`
    <p>Hi ${displayName},</p>
    <p>Welcome to <strong>KeepMyLedger</strong>. ${trialHtml}</p>
    <p>Import your first bank statement, let the AI categorise your transactions, and see where your money is going.</p>
    <a class="btn" href="${appUrl()}/import">Get started →</a>
    <p>Questions? Just reply to this email.</p>
    <p>The KeepMyLedger team</p>
  `);
  const text = [
    `Hi ${displayName},`,
    '',
    `Welcome to KeepMyLedger. ${trialText}`,
    '',
    `Import your first statement: ${appUrl()}/import`,
    '',
    'Questions? Just reply to this email.',
    '',
    'The KeepMyLedger team',
  ].join('\n');

  void sendEmail({ to: recipientEmail, subject, html, text });
}

// ── Password reset email ──────────────────────────────────────────────────────

export function passwordResetEmail(displayName: string, recipientEmail: string, resetLink: string): void {
  const subject = 'Reset your KeepMyLedger password';
  const html = baseHtml(`
    <p>Hi ${displayName},</p>
    <p>We received a request to reset your password. Click the button below to choose a new one.</p>
    <a class="btn" href="${resetLink}">Reset my password</a>
    <p>This link expires in <strong>24 hours</strong>. If you didn't request a reset, you can safely ignore this email.</p>
    <p>The KeepMyLedger team</p>
  `);
  const text = [
    `Hi ${displayName},`,
    '',
    'We received a request to reset your KeepMyLedger password.',
    '',
    `Reset link (expires in 24 hours): ${resetLink}`,
    '',
    "If you didn't request a reset, ignore this email.",
    '',
    'The KeepMyLedger team',
  ].join('\n');

  void sendEmail({ to: recipientEmail, subject, html, text });
}

// ── Trial-ending reminder ─────────────────────────────────────────────────────

export function trialEndingEmail(displayName: string, recipientEmail: string, daysLeft: number): void {
  const subject = `Your KeepMyLedger trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
  const html = baseHtml(`
    <p>Hi ${displayName},</p>
    <p>Your free trial ends in <strong>${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}</strong>.</p>
    <p>Add a payment method now to keep your imports, categories, and AI Assist working without interruption.</p>
    <a class="btn" href="${appUrl()}/billing">Add payment method →</a>
    <p>After your trial, you can still <em>view</em> your existing transactions at any time. A card is only needed to import new data or use AI Assist.</p>
    <p>The KeepMyLedger team</p>
  `);
  const text = [
    `Hi ${displayName},`,
    '',
    `Your KeepMyLedger free trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`,
    '',
    `Add a payment method to keep access: ${appUrl()}/billing`,
    '',
    'The KeepMyLedger team',
  ].join('\n');

  void sendEmail({ to: recipientEmail, subject, html, text });
}

// ── Payment failed ────────────────────────────────────────────────────────────

export function paymentFailedEmail(displayName: string, recipientEmail: string): void {
  const subject = 'Action required: KeepMyLedger payment failed';
  const html = baseHtml(`
    <p>Hi ${displayName},</p>
    <p>We were unable to process your KeepMyLedger subscription payment.</p>
    <p>Please update your payment method to avoid losing access to imports and AI Assist.</p>
    <a class="btn" href="${appUrl()}/billing">Update payment method →</a>
    <p>The KeepMyLedger team</p>
  `);
  const text = [
    `Hi ${displayName},`,
    '',
    'We were unable to process your KeepMyLedger subscription payment.',
    '',
    `Update your payment method: ${appUrl()}/billing`,
    '',
    'The KeepMyLedger team',
  ].join('\n');

  void sendEmail({ to: recipientEmail, subject, html, text });
}

// ── New user signup notification (internal) ───────────────────────────────────

export function newUserSignupNotification(displayName: string, userEmail: string | null, provider: string): void {
  const supportAddress = process.env.SES_SUPPORT_ADDRESS;
  if (!supportAddress) return;

  const subject = 'New user signup — KeepMyLedger';
  const now = new Date().toISOString();
  const emailLine = userEmail ?? '(none)';
  const html = baseHtml(`
    <p>A new user just signed up.</p>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td style="padding:6px 0;color:#9E9B8E;width:110px;">Name</td><td style="padding:6px 0;">${displayName}</td></tr>
      <tr><td style="padding:6px 0;color:#9E9B8E;">Email</td><td style="padding:6px 0;">${emailLine}</td></tr>
      <tr><td style="padding:6px 0;color:#9E9B8E;">Provider</td><td style="padding:6px 0;">${provider}</td></tr>
      <tr><td style="padding:6px 0;color:#9E9B8E;">Time</td><td style="padding:6px 0;">${now}</td></tr>
    </table>
  `);
  const text = [
    'New user signup — KeepMyLedger',
    '',
    `Name:     ${displayName}`,
    `Email:    ${emailLine}`,
    `Provider: ${provider}`,
    `Time:     ${now}`,
  ].join('\n');

  // Send directly via SES (bypassing the user suppression check — this is an
  // internal address, not a user record).
  const from = process.env.SES_FROM_ADDRESS;
  if (!from) {
    console.log(`[email:dev] To: ${supportAddress} | Subject: ${subject}\n${text}\n`);
    return;
  }
  void getClient().send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [supportAddress] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    },
    ...(process.env.SES_CONFIGURATION_SET
      ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
      : {}),
  })).catch((err: Error) => {
    console.error('[email] SES send failed (signup notification):', err.message, '| to:', supportAddress);
  });
}
