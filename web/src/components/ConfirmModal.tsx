import React from 'react';
import { colors, radii, shadows } from '../styles/tokens';

interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const dialogStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 28, maxWidth: 400, width: '100%',
  boxShadow: shadows.modal, border: `1px solid ${colors.softLine}`,
};
const messageStyle: React.CSSProperties = {
  fontSize: 15, color: colors.darkSlate, marginBottom: 24, lineHeight: 1.5,
};
const footerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 10,
};
const cancelBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm, border: `1px solid ${colors.surfaceLine}`,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 14, color: colors.mutedGray,
};
const confirmBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: radii.sm, border: `1px solid ${colors.dangerFg}`,
  background: colors.dangerFg, cursor: 'pointer', fontSize: 14, color: '#fff', fontWeight: 600,
};

export function ConfirmModal({ message, confirmLabel = 'Delete', onConfirm, onCancel }: Props) {
  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-msg"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={dialogStyle}>
        <p id="confirm-modal-msg" style={messageStyle}>{message}</p>
        <div style={footerStyle}>
          <button style={cancelBtn} onClick={onCancel} autoFocus>Cancel</button>
          <button style={confirmBtn} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
