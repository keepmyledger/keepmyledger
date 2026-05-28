/**
 * Shared validator for business names. Used by:
 *   - POST /api/auth/local/register  (require a real name at signup)
 *   - POST /api/orgs/:orgId/businesses          (block "Personal" on create)
 *   - PATCH /api/orgs/:orgId/businesses/:id     (block "Personal" on rename)
 *
 * "Personal" is the historical placeholder name created by provisionDefaults
 * and the org-seeding migrations. Reserving it lets the web app use the name
 * itself as a "needs setup" sentinel — see BusinessSetupModal.
 */

export const PLACEHOLDER_BUSINESS_NAME = 'Personal';
export const BUSINESS_NAME_MAX_LENGTH = 100;
export const PLACEHOLDER_REJECTION_MESSAGE =
  "'Personal' isn't a business name. Try something like 'Acme LLC' or 'Jane Smith Consulting'.";

export function isPlaceholderName(name: string): boolean {
  return name.trim().toLowerCase() === PLACEHOLDER_BUSINESS_NAME.toLowerCase();
}

export type BusinessNameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateBusinessName(raw: unknown): BusinessNameValidation {
  if (typeof raw !== 'string') return { ok: false, error: 'Business name is required' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Business name is required' };
  if (trimmed.length > BUSINESS_NAME_MAX_LENGTH) {
    return { ok: false, error: `Business name must be ${BUSINESS_NAME_MAX_LENGTH} characters or fewer` };
  }
  if (isPlaceholderName(trimmed)) return { ok: false, error: PLACEHOLDER_REJECTION_MESSAGE };
  return { ok: true, name: trimmed };
}
