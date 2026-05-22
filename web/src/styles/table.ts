import React from 'react';
import { colors, radii, shadows } from './tokens';

// Shared table/page styles used across Rules, Accounts, Categories, etc.
// Brand palette comes from ./tokens.ts (STYLING.md).
export const filterBarStyle: React.CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
  background: colors.cream, border: `1px solid ${colors.softLine}`,
  borderRadius: radii.sm, padding: 12, marginBottom: 12,
};
export const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 11, color: colors.mutedGray, textTransform: 'uppercase',
  letterSpacing: 0.5, fontWeight: 600,
};
export const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  fontSize: 14, background: colors.warmWhite, textTransform: 'none', letterSpacing: 'normal',
  fontWeight: 400, color: colors.darkSlate,
};
export const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 12, color: colors.mutedGray, fontWeight: 600,
};
// NOTE: pair with className="table-wrap" on the wrapping div so mobile gets horizontal scroll.
export const tableWrapStyle: React.CSSProperties = {
  border: `1px solid ${colors.softLine}`, borderRadius: radii.md, overflowX: 'auto',
  boxShadow: shadows.card, background: colors.warmWhite,
};
export const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', background: colors.cream,
  borderBottom: `1px solid ${colors.softLine}`, fontSize: 11, fontWeight: 600,
  color: colors.mutedGray, textTransform: 'uppercase', letterSpacing: 0.5,
  position: 'sticky', top: 0,
};
export const tdStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
export const buttonStyle: React.CSSProperties = {
  padding: '6px 14px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 14, color: colors.darkSlate,
};
export const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle, background: colors.forestGreen, color: '#fff',
  border: `1px solid ${colors.forestGreen}`, fontWeight: 600,
};
export const smallButtonStyle: React.CSSProperties = {
  padding: '3px 8px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 12, color: colors.darkSlate,
};
export const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
export const modalStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 20,
  width: 480, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto',
  boxShadow: shadows.modal, border: `1px solid ${colors.softLine}`,
};
export const rowStripe = (idx: number): React.CSSProperties => ({
  background: idx % 2 === 0 ? colors.warmWhite : colors.cream,
  borderBottom: `1px solid ${colors.softLine}`,
});
export const pillStyle = (bg: string, color: string): React.CSSProperties => ({
  background: bg, color, padding: '2px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 500, display: 'inline-block',
});
