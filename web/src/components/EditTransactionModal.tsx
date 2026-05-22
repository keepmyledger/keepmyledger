import React, { useState } from 'react';
import type { Transaction } from '@keepmyledger/shared';
import { api } from '../api/client';
import { colors, radii, shadows } from '../styles/tokens';

interface Props {
  tx: Transaction;
  onClose: () => void;
  onSaved: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(43, 43, 43, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
};
const dialogStyle: React.CSSProperties = {
  background: colors.warmWhite, borderRadius: radii.lg, padding: 24, maxWidth: 460, width: '100%',
  boxShadow: shadows.modal, border: `1px solid ${colors.softLine}`,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: colors.mutedGray, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: `1px solid ${colors.surfaceLine}`, borderRadius: radii.sm,
  fontSize: 14, width: '100%', background: colors.warmWhite, color: colors.darkSlate,
};
const btn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: radii.sm, border: `1px solid ${colors.surfaceLine}`,
  background: colors.warmWhite, cursor: 'pointer', fontSize: 13, color: colors.darkSlate,
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: colors.forestGreen, borderColor: colors.forestGreen, color: '#fff', fontWeight: 600,
};

/**
 * Edit a transaction's parsed fields (date / description / amount).
 * Use when the bank-statement parser read a row incorrectly.
 * Category and tax description are edited inline on the Transactions table.
 */
export function EditTransactionModal({ tx, onClose, onSaved }: Props) {
  const [date, setDate] = useState(tx.date);
  const [description, setDescription] = useState(tx.description);
  // Amount is signed; show as a string so the user can type a leading minus
  const [amountStr, setAmountStr] = useState(tx.amount.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Date must be YYYY-MM-DD');
      return;
    }
    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setError('Description cannot be empty');
      return;
    }
    const amt = Number(amountStr);
    if (!Number.isFinite(amt)) {
      setError('Amount must be a number');
      return;
    }
    const update: Record<string, unknown> = {};
    if (date !== tx.date) update.date = date;
    if (trimmedDesc !== tx.description) update.description = trimmedDesc;
    if (Math.round(amt * 100) !== Math.round(tx.amount * 100)) update.amount = amt;
    if (Object.keys(update).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.transactions.update(tx.id, update);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Edit transaction</h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#666' }}>
          Fix a row that was parsed incorrectly. Updating these fields recomputes the
          dedup hash, so re-importing the same statement won't create a duplicate.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Amount (negative = expense)</label>
          <input
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        {error && (
          <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btn} disabled={busy}>Cancel</button>
          <button onClick={() => void submit()} style={btnPrimary} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
