// Brand design tokens for KeepMyLedger.
//
// The canonical brand + UI spec lives in /STYLING.md at the repo root.
// That doc explains intent (which token to use where, button/modal/chart
// conventions, PWA chrome, the "adding new UI" checklist). This file is
// the single source of hex values; import from here instead of hardcoding.
//
// If you add or rename a token, update STYLING.md in the same commit.

export const colors = {
  // Gold
  goldRich:    '#D4A72C',
  goldSoft:    '#F2C14E',
  goldAntique: '#9A6B12',

  // Green
  ledgerGreen: '#1F5C4A',
  forestGreen: '#2E7D61',

  // Neutrals
  warmWhite:   '#FFFDF8',
  cream:       '#F7F3E8',
  creamDeep:   '#EFE8D4',
  darkSlate:   '#2B2B2B',
  mutedGray:   '#5E5E5E',
  hintText:    '#888888', // lighter hint/placeholder text (counts, empty states)
  softLine:    '#E6DFCB', // hairline borders on cream surfaces
  surfaceLine: '#E1DACB', // slightly stronger border for cards
  shadow:      'rgba(31, 41, 32, 0.08)',

  // Feedback (warm, non-fintech variants of red / amber / green)
  successBg:   '#E7F1EA',
  successFg:   '#1F5C4A',
  warningBg:   '#FBEFD0',
  warningFg:   '#8A5A20',
  dangerBg:    '#FBE8E2',
  dangerFg:    '#9A2D20',

  // Tier badges (used in Admin.tsx TierBadge; keep off-brand blues/purples
  // confined to these tokens so they don't bleed into other components)
  tierBusinessBg: '#E8F0FE',
  tierBusinessFg: '#1A56DB',
  tierOrgBg:      '#FDF4FF',
  tierOrgFg:      '#7E22CE',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

export const shadows = {
  card:   '0 1px 2px rgba(31, 41, 32, 0.05), 0 1px 3px rgba(31, 41, 32, 0.04)',
  raised: '0 4px 16px rgba(31, 41, 32, 0.10)',
  modal:  '0 12px 40px rgba(31, 41, 32, 0.22)',
} as const;

export const fonts = {
  heading: '"Bree Serif", "Merriweather", Georgia, serif',
  body:    '"Inter", "Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono:    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;
