import type { ReceiptStoragePreference } from '@keepmyledger/shared';
import { getAppMode } from '../../auth/context';

/**
 * Server-wide default backend used when a user has no explicit
 * `receiptStoragePreference`. KML's hosted storage is the natural default in
 * SaaS (when configured); self-hosters and unconfigured installs fall through
 * to Drive.
 */
export function getDefaultReceiptStorage(kmlAvailable: boolean): ReceiptStoragePreference {
  if (kmlAvailable && getAppMode() === 'saas') return 'kml';
  return 'drive';
}
