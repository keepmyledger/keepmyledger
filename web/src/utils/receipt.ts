import type { Receipt } from '@keepmyledger/shared';

/**
 * Resolve display name + viewable URL + content-type label for a Receipt,
 * regardless of whether it lives in the user's Google Drive or in our own
 * S3-compatible bucket.
 */
export function receiptView(r: Receipt): {
  name: string;
  href: string | null;
  contentType: string | null;
} {
  if (r.storageBackend === 's3') {
    return {
      name: r.originalFilename ?? `receipt-${r.id}`,
      href: `/api/receipts/${r.id}/download`,
      contentType: r.contentType,
    };
  }
  return {
    name: r.driveFileName ?? `receipt-${r.id}`,
    href: r.driveWebViewLink,
    contentType: r.driveMimeType,
  };
}
