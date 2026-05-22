// Design tokens.
//
// All colour/spacing values live here; import from this module instead of
// hard-coding. Tokens are intentionally generic so the UI can be restyled
// without touching component logic.
//
// If you add or rename a token, update every import site in the same commit.

export const colors = {
  // Primary accent (blue)
  goldRich:    '#1D4ED8',
  goldSoft:    '#3B82F6',
  goldAntique: '#1E40AF',

  // Surface / header
  ledgerGreen: '#1E293B',
  forestGreen: '#334155',

  // Neutrals
  warmWhite:   '#FFFFFF',
  cream:       '#F8FAFC',
  creamDeep:   '#F1F5F9',
  darkSlate:   '#0F172A',
  mutedGray:   '#64748B',
  softLine:    '#E2E8F0', // hairline borders
  surfaceLine: '#CBD5E1', // slightly stronger border for cards
  shadow:      'rgba(15, 23, 42, 0.08)',

  // Feedback
  successBg:   '#DCFCE7',
  successFg:   '#166534',
  warningBg:   '#FEF9C3',
  warningFg:   '#854D0E',
  dangerBg:    '#FEE2E2',
  dangerFg:    '#991B1B',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

export const shadows = {
  card:   '0 1px 2px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.04)',
  raised: '0 4px 16px rgba(15, 23, 42, 0.10)',
  modal:  '0 12px 40px rgba(15, 23, 42, 0.22)',
} as const;

export const fonts = {
  heading: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  body:    '"Inter", "Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono:    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
