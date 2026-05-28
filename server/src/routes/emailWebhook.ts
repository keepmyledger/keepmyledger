/**
 * emailWebhook: handles AWS SES bounce/complaint notifications via SNS.
 *
 * AWS SES → SNS Topic → HTTP subscription → POST /api/email/ses-webhook
 *
 * Security: Every SNS notification is verified using AWS's published signing
 * certificate before any DB mutation occurs.
 *
 * Setup:
 *   1. Create an SNS topic and subscribe it to this endpoint.
 *   2. On first subscription, SNS sends a SubscriptionConfirmation request;
 *      this handler fetches the SubscribeURL automatically.
 *   3. Set your SES notification type (Bounce/Complaint) to publish to the
 *      SNS topic.
 */

import { Router } from 'express';
import express from 'express';
import https from 'https';
import crypto from 'crypto';
import type { DbAdapter } from '../db/adapter';
import { getUserRepo } from '../auth/context';
import { hashEmail } from '../auth/emailHash';

// SNS signs messages with SHA1withRSA; cert/subscribe URLs must be from sns.*.amazonaws.com.
const SNS_CERT_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

function parseSnsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !SNS_CERT_HOST_RE.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/** Cached certs by URL to avoid repeated downloads. */
const certCache = new Map<string, string>();

function fetchCert(url: string): Promise<string> {
  const parsed = parseSnsUrl(url);
  if (!parsed) return Promise.reject(new Error('Cert URL must be from sns.*.amazonaws.com over HTTPS'));
  const safeUrl = parsed.href;
  if (certCache.has(safeUrl)) return Promise.resolve(certCache.get(safeUrl)!);
  return new Promise((resolve, reject) => {
    https.get(safeUrl, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => { certCache.set(safeUrl, data); resolve(data); });
    }).on('error', reject);
  });
}

function buildSigningString(msg: Record<string, string>): string {
  const fields = msg.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

  return fields
    .filter((f) => msg[f] !== undefined)
    .map((f) => `${f}\n${msg[f]}\n`)
    .join('');
}

async function verifySnsSignature(msg: Record<string, string>): Promise<boolean> {
  try {
    const certUrl = msg.SigningCertURL ?? '';
    const cert = await fetchCert(certUrl); // fetchCert validates the URL internally
    const signingString = buildSigningString(msg);
    const signature = Buffer.from(msg.Signature ?? '', 'base64');

    const verify = crypto.createVerify('sha1WithRSAEncryption');
    verify.update(signingString);
    return verify.verify(cert, signature);
  } catch {
    return false;
  }
}

/** Confirm an SNS subscription by fetching the SubscribeURL. */
function confirmSubscription(subscribeUrl: string): void {
  const parsed = parseSnsUrl(subscribeUrl);
  if (!parsed) return;
  https.get(parsed.href, (res) => {
    res.resume(); // drain
    console.log('[emailWebhook] SNS subscription confirmed, status', res.statusCode);
  }).on('error', (err) => {
    console.error('[emailWebhook] SNS subscription confirm error:', err.message);
  });
}

export function createEmailWebhookRouter(db: DbAdapter): Router {
  const router = Router();

  router.post('/ses-webhook', express.text({ type: '*/*' }), async (req, res) => {
    try {
      const messageType = req.headers['x-amz-sns-message-type'] as string | undefined;
      if (!messageType) {
        res.status(400).json({ error: 'Missing SNS message type' });
        return;
      }

      // SNS sends Content-Type: text/plain even though the body is JSON.
      // express.json() won't parse it, so we parse the raw text here.
      let msg: Record<string, string>;
      try {
        const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        msg = JSON.parse(raw) as Record<string, string>;
      } catch {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }

      const valid = await verifySnsSignature(msg);
      if (!valid) {
        console.warn('[emailWebhook] Invalid SNS signature, rejecting');
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }

      if (messageType === 'SubscriptionConfirmation') {
        confirmSubscription(msg.SubscribeURL);
        res.status(200).end();
        return;
      }

      if (messageType !== 'Notification') {
        res.status(200).end();
        return;
      }

      let notification: Record<string, unknown>;
      try {
        notification = JSON.parse(msg.Message) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'Invalid notification JSON' });
        return;
      }

      const notifType = notification.notificationType as string | undefined;
      const now = new Date().toISOString();
      const users = getUserRepo(db);

      if (notifType === 'Bounce') {
        const bounce = notification.bounce as Record<string, unknown> | undefined;
        const recipients = (bounce?.bouncedRecipients ?? []) as Array<{ emailAddress: string }>;
        for (const r of recipients) {
          const email = r.emailAddress?.toLowerCase();
          if (!email) continue;
          await users.markEmailBounced(hashEmail(email), now);
          console.log('[emailWebhook] bounce recorded for', email);
        }
      } else if (notifType === 'Complaint') {
        const complaint = notification.complaint as Record<string, unknown> | undefined;
        const recipients = (complaint?.complainedRecipients ?? []) as Array<{ emailAddress: string }>;
        for (const r of recipients) {
          const email = r.emailAddress?.toLowerCase();
          if (!email) continue;
          await users.markEmailComplained(hashEmail(email), now);
          console.log('[emailWebhook] complaint recorded for', email);
        }
      }

      res.status(200).end();
    } catch (err) {
      console.error('[emailWebhook] error:', (err as Error).message);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
